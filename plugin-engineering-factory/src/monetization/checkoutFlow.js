import {
  buildCheckoutPlaceholderUrl,
  createError,
  hasConfiguredPublicValue,
  isPlaceholderValue,
  nowIso
} from "./paySiteConfig.js";

export function createCheckoutFlow({
  config,
  authFlow,
  callEdgeFunction,
  getInstallationId
}) {
  return {
    async createCheckout({
      productKey = config.productKey,
      planKey = config.planKey,
      installationId = null,
      successUrl = config.checkoutSuccessUrl,
      cancelUrl = config.checkoutCancelUrl
    } = {}) {
      await authFlow.refreshSessionIfNeeded().catch(() => null);
      await authFlow.ensureValidSession();

      if (
        config.checkoutMode === "test"
        && (
          isPlaceholderValue(productKey)
          || !hasConfiguredPublicValue(config.publicSupabaseAnonKey)
        )
      ) {
        return {
          checkoutUrl: buildCheckoutPlaceholderUrl(config, { productKey, planKey }),
          sessionId: `test_session_${Date.now()}`,
          localOrderId: `local_order_${Date.now()}`,
          createdAt: nowIso()
        };
      }

      if (isPlaceholderValue(productKey)) {
        throw createError("Product is not configured.", "PRODUCT_KEY_PENDING", 404);
      }

      if (!hasConfiguredPublicValue(planKey)) {
        throw createError("Plan is not configured.", "PLAN_NOT_FOUND", 404);
      }

      const response = await callEdgeFunction("create-checkout-session", {
        requireAuth: true,
        body: {
          productKey,
          planKey,
          installationId: installationId ?? await getInstallationId(),
          successUrl,
          cancelUrl,
          source: "chrome_extension"
        }
      });
      return {
        checkoutUrl: response.checkoutUrl,
        sessionId: response.sessionId,
        localOrderId: response.localOrderId
      };
    }
  };
}

