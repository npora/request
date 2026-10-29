import { scenarios, createScenarioContext } from './scenarios.js'

const $ = id => document.getElementById(id)
for (const element of document.querySelectorAll('[data-version]')) element.textContent = __VERSION__
const results = new Map(scenarios.map(value => [value.id, {
  lines: [], requests: [], outcome: 'idle', elapsed: 0, state: 'READY', progress: {}
}]))
let selected = scenarios[0], controller, running = false, batch = false

for (const [index, scenario] of scenarios.entries()) {
  const button = document.createElement('button')
  button.type = 'button'; button.className = 'scenario'; button.dataset.scenario = scenario.id
  const number = document.createElement('span'); number.className = 'scenario-number'; number.textContent = String(index + 1).padStart(2, '0')
  const name = document.createElement('span'); name.textContent = scenario.name
  const indicator = document.createElement('span'); indicator.className = 'scenario-indicator'; indicator.setAttribute('aria-hidden', 'true')
  button.append(number, name, indicator)
  button.addEventListener('click', () => { selected = scenario; render() })
  $('scenarios').append(button)
}

function render() {
  const result = results.get(selected.id)
  $('demo-tag').textContent = selected.tag; $('demo-title').textContent = selected.name
  $('demo-description').textContent = selected.description; $('demo-code').textContent = selected.code
  for (const button of $('scenarios').children) {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === selected.id))
    const outcome = results.get(button.dataset.scenario).outcome
    button.lastElementChild.textContent = { passed: '✓', failed: '!', running: '◌' }[outcome] ?? ''
  }
  $('outcome').dataset.outcome = result.outcome
  $('outcome').textContent = { idle: '等待运行', running: '运行中', passed: '验证通过', failed: '运行失败', stopped: '已停止' }[result.outcome]
  $('output').textContent = result.lines.join('\n') || '选择运行，观察真实响应。'
  $('stream-state').textContent = result.state
  $('elapsed').textContent = result.elapsed ? `${(result.elapsed / 1000).toFixed(2)} s · ${result.requests.length} 次请求` : '准备就绪'
  $('request-count').textContent = String(result.requests.length)
  $('requests').replaceChildren()
  if (!result.requests.length) {
    const row = $('requests').insertRow(); row.className = 'empty-row'
    const cell = row.insertCell(); cell.colSpan = 3; cell.textContent = '运行后，实际发出的每次请求会显示在这里。'
  }
  for (const request of result.requests) {
    const row = $('requests').insertRow()
    row.insertCell().textContent = `${request.method} ${request.path}`
    const status = row.insertCell(); status.textContent = String(request.status)
    status.className = request.status >= 200 && request.status < 300 ? 'status-ok' : 'status-error'
    row.insertCell().textContent = `${Math.round(request.ms)} ms`
  }
  $('transfers').hidden = selected.id !== 'transfer'
  for (const type of ['upload', 'download']) {
    const value = result.progress[type]
    if (!value || value.progress !== undefined) $(type + '-progress').value = value?.progress ?? 0
    else $(type + '-progress').removeAttribute('value')
    $(type + '-label').textContent = value ? `${value.progress === undefined ? '传输中' : Math.round(value.progress * 100) + '%'} · ${(value.loaded / 1024).toFixed(0)} KiB` : '0%'
  }
  $('run').disabled = running || batch; $('run-all').disabled = running || batch
  $('stop').disabled = !running; $('clear').disabled = running || batch
}

async function run(scenario) {
  running = true; controller = new AbortController()
  const activeController = controller
  const result = { lines: [], requests: [], outcome: 'running', elapsed: 0, state: 'READY', progress: {} }
  results.set(scenario.id, result)
  const start = performance.now()
  const update = () => { result.elapsed = performance.now() - start; if (selected.id === scenario.id) render() }
  const log = value => {
    // Bounded output keeps the console usable even if future scenarios emit more.
    result.lines.push(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    if (result.lines.length > 100) result.lines.shift()
    update()
  }
  const ticker = setInterval(update, 100)
  render()
  try {
    await scenario.run(createScenarioContext({ signal: activeController.signal, log,
      state: value => { result.state = value.toUpperCase(); update() },
      progress: (type, value) => { result.progress[type] = value; update() },
      network: value => { result.requests.push(value); update() }
    }))
    result.outcome = 'passed'; log('✓ 已验证预期行为')
  } catch (error) {
    result.outcome = activeController.signal.aborted ? 'stopped' : 'failed'
    log({ code: error.code ?? 'DEMO_ERROR', status: error.status, message: error.message, data: error.data })
  } finally {
    // Cancel sibling work after an error and release remaining readers/timers.
    activeController.abort(); clearInterval(ticker); result.elapsed = performance.now() - start
    running = false; controller = undefined; render()
  }
}

$('run').addEventListener('click', () => { void run(selected) })
$('stop').addEventListener('click', () => { batch = false; controller?.abort() })
$('run-all').addEventListener('click', async () => {
  batch = true
  try {
    for (const scenario of scenarios) {
      if (!batch) break
      selected = scenario; render(); await run(scenario)
    }
  } finally { batch = false; render() }
})
$('clear').addEventListener('click', () => {
  results.set(selected.id, { lines: [], requests: [], outcome: 'idle', elapsed: 0, state: 'READY', progress: {} }); render()
})
$('copy-install').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('npm i @npora/request'); $('copy-status').textContent = '安装命令已复制' }
  catch { $('copy-status').textContent = '请复制：npm i @npora/request' }
})
window.addEventListener('pagehide', () => controller?.abort())
render()
