// LocalStorage wrapper with prefix
const PREFIX = 'hubchat'

class Storage {
  static get(key) {
    try {
      const item = localStorage.getItem(`${PREFIX}_${key}`)
      return item ? JSON.parse(item) : null
    } catch (e) {
      return null
    }
  }

  static set(key, value) {
    try {
      localStorage.setItem(`${PREFIX}_${key}`, JSON.stringify(value))
      return true
    } catch (e) {
      return false
    }
  }

  static remove(key) {
    try {
      localStorage.removeItem(`${PREFIX}_${key}`)
      return true
    } catch (e) {
      return false
    }
  }

  static clear() {
    try {
      const keys = Object.keys(localStorage)
      keys.forEach(key => {
        if (key.startsWith(PREFIX)) {
          localStorage.removeItem(key)
        }
      })
      return true
    } catch (e) {
      return false
    }
  }
}

export default Storage