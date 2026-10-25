import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'

// jsdom 26 ships a WebIDL stub for crypto.subtle.digest that accepts nothing; use Node's WebCrypto
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

// jsdom lacks these browser APIs; the components only need them to exist.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub
}

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }
  // canvas drawing is not exercised in jsdom; silence its "not implemented" noise
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  // Radix uses these for pointer interactions
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.scrollTo ??= () => {}

  // jsdom 26's File predates Blob.prototype.arrayBuffer; uploads read bytes through it
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function (this: File) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result
          const bytes = typeof result === 'string'
            ? new TextEncoder().encode(result)
            : new Uint8Array(result as ArrayBuffer)
          // Node's WebCrypto only accepts buffers from its own realm
          const copy = Buffer.from(bytes)
          resolve(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength))
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
}
