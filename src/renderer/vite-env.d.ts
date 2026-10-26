/// <reference types="vite/client" />
import type { BiodiversityAPI } from '../preload/index'

declare global {
  interface Window {
    api: BiodiversityAPI
  }
}

export {}
