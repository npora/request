import { applyLanguage, getLanguage, setLanguage } from './i18n.js'
const language = document.getElementById('language')
language.value = getLanguage()
language.addEventListener('change', () => { setLanguage(language.value); applyLanguage() })
applyLanguage()
