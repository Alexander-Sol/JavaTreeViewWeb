import { App } from './app'

const container = document.getElementById('viewer-container')
if (!container) throw new Error('Missing #viewer-container')

new App(container)
