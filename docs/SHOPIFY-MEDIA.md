# Shopify catalogue media

The generated Shopify CSV is deliberately portable. Its `Image Src`, `Image Position` and `Image Alt Text` columns stay empty because a local fixture path is not a public URL that Shopify can import.

After uploading the product artwork to **Shopify admin > Content > Files**, copy each HTTPS file URL into a store-specific JSON map. Keep that map in a private brand repository or in the ignored `.shopify-media/` directory; it belongs to one store and is not part of the reusable method.

```json
{
  "product-handle": {
    "url": "https://cdn.shopify.com/s/files/example/product.webp",
    "alt": "Product shown from the front",
    "position": 1
  }
}
```

Hydrate a copy of the generated catalogue:

```sh
npm run shopify:hydrate-media -- \
  --input dist/example-store/imports/shopify-products.csv \
  --map ../private-brand-data/shopify-media.json \
  --output ../private-brand-data/shopify-products-with-media.csv
```

The command never edits the input CSV. It validates the required Shopify image columns, HTTPS URLs, positions, duplicate map handles and handles that do not exist in the catalogue. It assigns one image to the first row of each mapped product while leaving every variant row and all non-image fields intact.

Import the hydrated output into the matching Shopify store. Retain the canonical generated CSV without store URLs so the same brand pack can be deployed to another store without carrying media references from the previous one.
