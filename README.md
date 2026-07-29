# Storefront Portability Kit

One storefront contract. Native commerce output without rebuilding the same store twice.

This source-available kit turns a brand pack into a native Shopify theme and a lightweight review build. An authorised WooCommerce extension can be supplied at build time to produce the matching native WordPress theme, product import and Playground package from the same contract.

The repository includes one deliberately neutral fixture, `Field Supply`, so the public build can be inspected and tested without exposing a client or portfolio brand.

## What is shared

- brand language, navigation, catalogue data and design tokens;
- a section vocabulary for composing the storefront;
- product options and price modifiers;
- explicit card-level colour and finish previews where the product form remains unchanged;
- responsive presentation and progressive browser behaviour;
- validation rules and repeatable build commands.

## What remains native

- Shopify Liquid, JSON templates, theme settings, product forms, cart endpoints, branded password and 404 states, and social/structured metadata;
- WordPress PHP, WooCommerce products, variations, Store API and checkout when the authorised extension is present;
- inventory, customers, payments, tax and order state on the platform that owns them.

The static preview is a review surface. It does not pretend to be either commerce backend.

## Quick start

Node.js 22.12 or newer is required.

```powershell
npm install
npm run validate
npm run preview
```

Build the included fixture:

```powershell
npm run build -- --brand example-store --target all
```

The public build writes:

```text
dist/example-store/preview/                     portable review build
dist/example-store/shopify-theme/               native Shopify theme
dist/example-store/imports/shopify-products.csv Shopify product fixture
```

When an authorised WooCommerce adapter and seeder are available, pass them explicitly:

```powershell
npm run validate -- `
  --woocommerce-adapter-root <adapter-path> `
  --woocommerce-seed <seed.php-path>
```

That complete build also creates:

```text
dist/example-store/woocommerce-theme/                native WooCommerce theme
dist/example-store/imports/woocommerce-products.csv  WooCommerce product fixture
dist/example-store/playground/                       browser-hosted WordPress demo
```

The equivalent environment variables are `SFK_WOOCOMMERCE_ADAPTER_ROOT` and `SFK_WOOCOMMERCE_SEED`.

## Keep commercial brand packs elsewhere

The method accepts external data and output roots. This keeps the visible method separate from client or showcase material.

```powershell
npm run validate -- --brands-root ../storefront-showcases/brands --output-root ../storefront-builds
npm run build -- --brand my-store --target all --brands-root ../storefront-showcases/brands --output-root ../storefront-builds
npm run preview -- --brand my-store --output-root ../storefront-builds
```

The equivalent environment variables are `SFK_BRANDS_ROOT` and `SFK_OUTPUT_ROOT`. Command-line values take precedence.

## Shopify catalogue media

Local fixture artwork travels with the theme. Shopify product CSVs leave product and variant image URLs empty because Shopify only accepts a public, importable URL. The theme prefers native variant media, then a packaged variant-specific asset, then native product media, and finally the packaged base asset. The build also emits a portable media manifest so the optional hydration step can map product and variant assets to store-specific HTTPS URLs without putting CDN details in the brand pack.

## Validation

`npm run validate` performs the public release gate:

1. validates every brand, section, product and asset reference;
2. tests variant expansion, CSV alignment and the public adapter contract;
3. builds the preview and Shopify outputs;
4. runs Shopify Theme Check against every compiled theme.

Supplying both WooCommerce paths extends the same command with the native WooCommerce build, adapter checks and reproducible Playground packages. Supplying only one path fails instead of silently producing a partial release.

Create the available release ZIPs and checksums with:

```powershell
npm run release
```

## Add a storefront

1. Copy `examples/example-store` into your chosen brand-pack repository.
2. Replace `brand.json`, `catalog.json` and the assets.
3. Compose the page from the supported section contract.
4. Run the complete validation against that external root.
5. Test product selection, cart and checkout in every native runtime being delivered.

If the storefront needs a new section type, implement it in the public Shopify adapter and in any authorised platform extension before using it in a brand pack. The underlying method is described in [METHOD.md](docs/METHOD.md), the platform boundary in [ARCHITECTURE.md](docs/ARCHITECTURE.md), and the connected deployment pattern in [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Repository map

```text
examples/             neutral end-to-end fixture
schema/               portable contracts
shared/               presentation and interaction contract
adapters/shopify/     native Liquid and JSON theme
scripts/              build, packaging and validation
tests/                contract and public-boundary tests
docs/                 method and runtime guides
```

## Licence

The original public material is covered by the [Zay End-Product License 1.0](LICENSE). You may use and modify the method to create, deliver and sell finished storefronts. You may not publish, share, sublicense or sell the reusable kit, its adapter, or a derived template or generator without written permission.

The executable WooCommerce adapter is not distributed here because WordPress-dependent PHP carries GPL redistribution rights. See [LICENSING.md](LICENSING.md) for the exact boundary.
