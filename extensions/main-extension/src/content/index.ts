import { config } from '../config'

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.source !== 'membership-extension-demo') {
    return
  }

  if (event.data.type === 'CONSUME_SINGLE_EXPORT') {
    const result = await chrome.runtime.sendMessage({
      type: 'CONSUME_USAGE',
      productKey: event.data.productKey,
      featureKey: config.featureKey,
      amount: 1,
    })

    window.postMessage({
      source: 'membership-extension-demo-response',
      type: 'CONSUME_SINGLE_EXPORT_RESULT',
      result,
    }, '*')
  }
})
