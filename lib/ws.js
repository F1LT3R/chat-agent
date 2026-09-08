export class ChatSocket {
  #ws = null
  #handlers = new Map()
  #retry = 0
  #closing = false

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.#ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.#ws.onopen = () => {
      this.#retry = 0
      this.emit('open')
    }
    this.#ws.onmessage = (ev) => {
      let m
      try {
        m = JSON.parse(ev.data)
      } catch {
        return
      }
      this.emit(m.type, m)
    }
    this.#ws.onclose = () => {
      this.emit('close')
      if (this.#closing) return
      this.#retry += 1
      const delay = Math.min(15000, 500 * 2 ** Math.min(this.#retry, 5))
      setTimeout(() => this.connect(), delay)
    }
    this.#ws.onerror = () => this.#ws.close()
  }

  close() {
    this.#closing = true
    this.#ws?.close()
  }

  send(obj) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(obj))
      return true
    }
    return false
  }

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set())
    this.#handlers.get(type).add(fn)
  }

  emit(type, data) {
    this.#handlers.get(type)?.forEach((fn) => fn(data))
    this.#handlers.get('*')?.forEach((fn) => fn(type, data))
  }
}
