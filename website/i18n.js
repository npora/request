import { messages, copyKeys } from './translations.js'

let language = 'en'
try {
  if (localStorage.getItem('npora-language') === 'zh-CN') language = 'zh-CN'
} catch { /* Storage can be unavailable in private or embedded contexts. */ }

export const getLanguage = () => language
export function setLanguage(value) {
  language = value === 'zh-CN' ? value : 'en'
  try { localStorage.setItem('npora-language', language) } catch { /* In-memory switching still works. */ }
}
export function t(value) {
  return messages[copyKeys[value] ?? textKeys.get(value) ?? value]?.[language] ?? value
}

const textKeys = new Map()
for (const [key, message] of Object.entries(messages)) {
  if (message.en) textKeys.set(message.en, key)
  if (message['zh-CN']) textKeys.set(message['zh-CN'], key)
}
// Only demo comments are translated; executable code and API data stay intact.
export function localizeCode(value) {
  return value.replace(/\/\/[^\n]*/g, comment => t(comment))
}
export function applyLanguage() {
  document.documentElement.lang = language
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n)
  }
  for (const attribute of ['aria-label', 'content']) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)))
    }
  }
  document.getElementById('language').setAttribute('aria-label', t('language'))
}
