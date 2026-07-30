# Architecture

## Shared contract

The shared layer owns:

- brand and catalog schemas;
- design tokens;
- semantic section names;
- CSS component contract;
- progressive browser behaviour;
- deterministic demo fixtures.

## Adapter boundary

The adapter layer owns:

| Concern | Shopify | Authorised WooCommerce extension |
| --- | --- | --- |
| Templates | Liquid and JSON templates | PHP templates and WordPress hooks |
| Editor controls | Theme settings, sections and blocks | Customizer/block settings and theme configuration |
| Product source | Shopify product and collection objects | WooCommerce product queries and objects |
| Cart | Shopify cart endpoints and native forms | WooCommerce cart fragments and native forms |
| Checkout | Shopify checkout | WooCommerce checkout |

No adapter emulates the other platform's backend. Shared code stops at the browser contract and portable content.

Option presentation metadata follows the same boundary. Adapters keep the platform's canonical option value untouched and use the shared browser contract only to relabel it. This avoids duplicated variants while preserving a stable no-JavaScript fallback and native stock ownership.

## Output

`npm run build -- --brand <id> --target all` produces the public outputs:

```text
dist/<id>/preview/
dist/<id>/shopify-theme/
dist/<id>/imports/shopify-products.csv
```

When `--woocommerce-adapter-root` and `--woocommerce-seed` are supplied, the complete build also produces:

```text
dist/<id>/woocommerce-theme/
dist/<id>/imports/woocommerce-products.csv
dist/<id>/playground/<id>-playground.zip
```

The preview is a review surface, not evidence that either native theme has passed platform validation.

The Playground bundle installs the generated WooCommerce theme, fetches a pinned WooCommerce release and seeds products through WooCommerce CRUD APIs. Stable SKUs and asset fingerprints make reruns idempotent without treating the generated catalogue as a permanent external database. The executable WordPress adapter and seeder enter through explicit external paths and are not part of the public tree.

## External data and output roots

Build, validation, Playground and release scripts accept `--brands-root <path>` and `--output-root <path>`. The equivalent environment variables are `SFK_BRANDS_ROOT` and `SFK_OUTPUT_ROOT`; command-line values take precedence. WooCommerce-enabled runs additionally accept `--woocommerce-adapter-root <path>` and `--woocommerce-seed <path>`, or `SFK_WOOCOMMERCE_ADAPTER_ROOT` and `SFK_WOOCOMMERCE_SEED`. Relative paths are resolved from the project root, while child scripts receive resolved absolute paths.

The defaults are `examples` and `dist`. Commercial brand packs can remain in a separate repository and pass their location at build time.
