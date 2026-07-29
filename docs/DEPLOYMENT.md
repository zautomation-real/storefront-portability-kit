# Connected deployment

Keep source data and compiled theme files on separate branches.

## Branch roles

- `main` contains brand packs, configuration and deployment workflow files.
- One branch per Shopify storefront contains only the compiled theme at its root.
- A compiled branch must use Shopify's standard theme directory structure: `assets`, `config`, `layout`, `locales`, `sections`, `snippets` and `templates`.

Example branch names:

```text
shopify/store-one
shopify/store-two
shopify/store-three
```

Shopify's GitHub integration can connect each branch to a separate theme. A commit on that branch updates the connected theme, while an edit made in Shopify's code editor is committed back to the same branch. See [Shopify's GitHub integration guide](https://shopify.dev/docs/storefronts/themes/tools/github).

The generated theme includes a branded native password template for regular password-protected stores. Shopify controls the access screen of development stores outside the theme, so validate the custom template in the editor or in an eligible store rather than treating the development-store gate as theme output.

`catalog_vendor` is a guard for compact staging catalogues, not a substitute for a Shopify collection. Liquid filters by vendor after Shopify has paginated the collection or search result, so a shared catalogue larger than one result page can produce sparse pages. Keep final showcase stores separate, as in the branch-per-store pattern above. If a production store must contain several brands, create native automated collections for each vendor and point navigation at those collections instead of relying on the presentation guard.

## Source of truth

Edit the shared contract and Shopify adapter in this repository, brand data in the brand-pack repository, and any authorised platform extension in its protected source repository. Treat deployment branches as compiled output. A direct edit to a deployment branch may appear in Shopify immediately, but the next build can replace it unless the same change is brought back into the source.

## Safe release order

1. Validate the external brand root.
2. Build each Shopify theme into an isolated output directory.
3. Commit each compiled theme to its own deployment branch.
4. Let Shopify update the connected draft theme.
5. Review the draft in the theme editor and storefront preview.
6. Publish only after an explicit release decision.

When the authorised external adapter and seeder are supplied, the same build packages WooCommerce themes and WordPress Playground bundles as workflow artifacts. A live WooCommerce deployment still needs a site-specific transport such as SSH, SFTP or a managed release process.
