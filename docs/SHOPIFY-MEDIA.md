# Shopify catalogue media

The generated Shopify CSV is deliberately portable. Its `Image Src`, `Image Position` and `Image Alt Text` columns stay empty because a local fixture path is not a public URL that Shopify can import.

After uploading the product artwork to **Shopify admin > Content > Files**, copy each HTTPS file URL into a store-specific JSON map. Keep that map in a private brand repository or in the ignored `.shopify-media/` directory; it belongs to one store and is not part of the reusable method.

```json
{
  "product-handle": {
    "url": "https://cdn.shopify.com/s/files/example/product.webp",
    "alt": "Product shown from the front",
    "position": 1,
    "variantAssets": {
      "assets/product-dark.webp": {
        "url": "https://cdn.shopify.com/s/files/example/product-dark.webp",
        "alt": "Product in the dark finish"
      }
    }
  }
}
```

Variant artwork is declared once in the portable catalogue. A rule may match one option or a more specific combination; the most specific matching rule wins.

```json
{
  "variantMedia": [
    {
      "match": { "Finish": "Dark" },
      "image": "assets/product-dark.webp",
      "alt": "Product in the dark finish"
    }
  ]
}
```

The Shopify build writes `shopify-media-manifest.json` beside the canonical product CSV. It connects each stable variant SKU to the local asset selected by these rules without putting a non-public local path into Shopify's URL columns.

Hydrate a copy of the generated catalogue:

```sh
npm run shopify:hydrate-media -- \
  --input dist/example-store/imports/shopify-products.csv \
  --map ../private-brand-data/shopify-media.json \
  --manifest dist/example-store/imports/shopify-media-manifest.json \
  --output ../private-brand-data/shopify-products-with-media.csv
```

The command never edits the input CSV. A media map may cover the full catalogue or only the products being hydrated in that run. It validates the required Shopify image columns, HTTPS URLs, positions and duplicate or unknown map handles. When a manifest is supplied, every CSV variant of each mapped product must have exactly one matching manifest SKU, and the manifest may not contain an extra SKU for that mapped product.

The hydrator assigns one primary product image and writes the matching CDN URL into Shopify's variant-image column while leaving all non-image fields intact. Supply the manifest whenever the map contains `variantAssets`, or whenever every variant of a mapped product should be explicitly associated with its primary image. It may be omitted when only the primary product image is being hydrated.

Import the hydrated output into the matching Shopify store. Retain the canonical generated CSV without store URLs so the same brand pack can be deployed to another store without carrying media references from the previous one.
