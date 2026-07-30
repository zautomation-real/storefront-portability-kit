import { isSafeSlug } from "./lib.mjs";
import { optionPresentationErrors } from "./option-presentation.mjs";
import { assertUniqueShopifyVariantSkus, productVariants } from "./platform-output.mjs";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function optionValue(value) {
  if (typeof value === "string") return { label: value, priceModifier: 0 };
  if (!isObject(value)) return { label: undefined, priceModifier: undefined };
  return {
    label: value.label,
    priceModifier: value.priceModifier ?? 0,
  };
}

function fail(errors, scope, message) {
  errors.push(`${scope}: ${message}`);
}

/**
 * Validate the portable product facts before they are projected to a platform.
 * This is deliberately synchronous and independent of the filesystem so an
 * operational adapter can run the exact contract pinned by its method commit.
 */
export function assertPortableCatalog(brand, catalog) {
  const errors = [];
  const brandId = brand?.id || "brand";

  if (!isObject(brand)) fail(errors, brandId, "brand must be an object");
  if (!isSafeSlug(brand?.id)) {
    fail(errors, brandId, "brand.id must use lowercase letters, numbers and single hyphens only");
  }
  if (!isNonEmpty(brand?.displayName)) fail(errors, brandId, "brand.displayName is required");
  if (!isObject(catalog) || !Array.isArray(catalog?.products)) {
    fail(errors, brandId, "catalog must be an object with a products array");
  }

  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  if (products.length < 3) fail(errors, brandId, "catalog must include at least 3 products");

  const productIds = new Set();
  for (const [productIndex, product] of products.entries()) {
    const fallbackScope = `${brandId}/product:${productIndex + 1}`;
    if (!isObject(product)) {
      fail(errors, fallbackScope, "product must be an object");
      continue;
    }
    const scope = `${brandId}/${product.id || `product:${productIndex + 1}`}`;
    if (!isSafeSlug(product.id)) {
      fail(errors, scope, "product id must use lowercase letters, numbers and single hyphens only");
    }
    if (productIds.has(product.id)) fail(errors, scope, `duplicate product id ${product.id}`);
    productIds.add(product.id);

    for (const field of ["name", "category", "description", "image"]) {
      if (!isNonEmpty(product[field])) fail(errors, scope, `${field} is required`);
    }
    if (isNonEmpty(product.image) && !/^assets\/[a-z0-9][a-z0-9._-]*$/i.test(product.image)) {
      fail(errors, scope, `invalid asset path ${JSON.stringify(product.image)}`);
    }
    if (!Number.isSafeInteger(product.price) || product.price < 0) {
      fail(errors, scope, "price must use non-negative safe integer minor currency units");
    }
    if (
      product.compareAtPrice != null &&
      (!Number.isSafeInteger(product.compareAtPrice) || product.compareAtPrice <= product.price)
    ) {
      fail(errors, scope, "compareAtPrice must be a safe integer above price");
    }

    if (product.details != null) {
      if (!Array.isArray(product.details) || !product.details.length) {
        fail(errors, scope, "details must be a non-empty array when supplied");
      } else {
        for (const [detailIndex, detail] of product.details.entries()) {
          const detailScope = `${scope}/details:${detailIndex + 1}`;
          if (!isObject(detail) || !isNonEmpty(detail.title) || !isNonEmpty(detail.body)) {
            fail(errors, detailScope, "title and body are required");
          }
        }
      }
    }

    const options = product.options ?? [];
    if (!Array.isArray(options)) {
      fail(errors, scope, "options must be an array");
      continue;
    }
    if (options.length > 3) fail(errors, scope, "products support at most 3 options");
    const optionNames = new Set();
    for (const [optionIndex, option] of options.entries()) {
      const optionScope = `${scope}/option:${optionIndex + 1}`;
      if (!isObject(option)) {
        fail(errors, optionScope, "option must be an object");
        continue;
      }
      if (!isNonEmpty(option.name)) fail(errors, optionScope, "option name is required");
      if (optionNames.has(option.name)) fail(errors, optionScope, `duplicate option name ${option.name}`);
      optionNames.add(option.name);
      if (!Array.isArray(option.values) || !option.values.length) {
        fail(errors, optionScope, "option needs at least one value");
        continue;
      }
      const values = new Set();
      for (const [valueIndex, rawValue] of option.values.entries()) {
        const value = optionValue(rawValue);
        const valueScope = `${optionScope}/value:${valueIndex + 1}`;
        if (!isNonEmpty(value.label)) fail(errors, valueScope, "option value label is required");
        if (values.has(value.label)) fail(errors, valueScope, `duplicate option value ${value.label}`);
        values.add(value.label);
        if (!Number.isSafeInteger(value.priceModifier)) {
          fail(errors, valueScope, "priceModifier must be a safe integer");
        }
      }
      for (const message of optionPresentationErrors(option)) fail(errors, optionScope, message);
    }

    try {
      const variants = productVariants(product);
      if (variants.length > 100) fail(errors, scope, `${variants.length} variants exceed the 100-variant fixture limit`);
      if (variants.some((variant) => !Number.isSafeInteger(variant.price) || variant.price < 0)) {
        fail(errors, scope, "every generated variant needs a valid non-negative price");
      }
    } catch (error) {
      fail(errors, scope, error.message);
    }
  }

  if (products.length) {
    try {
      assertUniqueShopifyVariantSkus(brand, catalog);
    } catch (error) {
      fail(errors, brandId, error.message);
    }
  }

  if (errors.length) {
    const error = new Error(`Portable catalogue validation failed:\n${errors.map((item) => `- ${item}`).join("\n")}`);
    error.code = "INVALID_PORTABLE_CATALOG";
    error.details = errors;
    throw error;
  }
  return true;
}
