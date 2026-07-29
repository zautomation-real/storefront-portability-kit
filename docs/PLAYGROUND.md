# WooCommerce demo in WordPress Playground

Each brand can be packaged as a reproducible WordPress Playground bundle when an authorised external WooCommerce adapter and seeder are available. The bundle contains the generated theme, the supplied product seeder and a Blueprint. WooCommerce itself is fetched from its official versioned WordPress.org ZIP URL; the repository does not store or version the plugin archive.

## Build

```powershell
npm run build:playground -- `
  --brand example-store `
  --woocommerce-adapter-root <adapter-path> `
  --woocommerce-seed <seed.php-path>
```

Outputs are ignored by Git and written to:

```text
dist/example-store/playground/example-store-playground.zip
```

The defaults pin WordPress 6.9, PHP 8.3 and WooCommerce 10.9.4. They can be overridden for compatibility testing:

```powershell
npm run build:playground -- `
  --brand example-store `
  --woocommerce-adapter-root <adapter-path> `
  --woocommerce-seed <seed.php-path> `
  --wordpress 6.9 --php 8.3 --woocommerce 10.9.4
```

The build fails when a product or storefront media reference is missing. Product fixtures are synchronized by stable SKU. Re-running the seed updates existing products and media, creates the full option combination as WooCommerce variations and removes only stale records previously created for that brand.

## Run locally without an account

```powershell
npx @wp-playground/cli@3.1.47 server --blueprint=./dist/example-store/playground/example-store-playground.zip --port=9400
```

The first run downloads the pinned WooCommerce ZIP from WordPress.org. No WordPress.com account, database server, PHP installation or Docker daemon is required.

Useful acceptance check after the server starts:

```powershell
$products = Invoke-RestMethod 'http://127.0.0.1:9400/wp-json/wc/store/v1/products?per_page=100'
$products | Select-Object id,name,has_options,images
```

Confirm the expected product count, a non-empty image for every product, option selection on variable products, sale pricing, add-to-cart and the cart page.

## Share

Host the generated bundle ZIP at a public URL that sends a permissive CORS header, URL-encode that URL, and use:

```text
https://playground.wordpress.net/?blueprint-url=<ENCODED_BUNDLE_URL>
```

Every visitor receives a fresh browser-hosted WordPress instance. Publishing the bundle distributes the generated theme under its applicable licences, so only share a completed demonstration that you are authorised to publish.

## Theme ZIP versus complete demo

The standalone `*-woocommerce-theme.zip` contains the native theme and its brand fixtures, but it does not create WooCommerce products by itself. Import `dist/<brand>/imports/woocommerce-products.csv` after installation, or use the `*-woocommerce-playground.zip` bundle when you want the catalog, images and variants seeded automatically. Until real products exist, fixture cards point to the native Shop page instead of pretending to be purchasable products.
