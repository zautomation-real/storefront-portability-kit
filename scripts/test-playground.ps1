param(
    [string] $BaseUrl = 'http://127.0.0.1:9400'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-CurlExit([string] $Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with curl exit code $LASTEXITCODE" }
}

$sfkCookiePath = [IO.Path]::GetTempFileName()
try {
    $sfkPageContent = (& curl.exe -sS -L --max-time 45 -c $sfkCookiePath -b $sfkCookiePath "$BaseUrl/") -join "`n"
    Assert-CurlExit 'Homepage request'

    $sfkNonce = [regex]::Match($sfkPageContent, 'name="sfk_newsletter_nonce" value="([^"]+)"').Groups[1].Value
    if (!$sfkNonce) { throw 'Newsletter nonce missing' }

    $sfkEmail = "qa-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
    function Invoke-NewsletterPost([string] $Email) {
        $sfkHeaders = & curl.exe -sS --max-time 45 -c $sfkCookiePath -b $sfkCookiePath -D - -o NUL -X POST `
            --data-urlencode 'action=sfk_newsletter_signup' `
            --data-urlencode "redirect_to=$BaseUrl/" `
            --data-urlencode "sfk_newsletter_nonce=$sfkNonce" `
            --data-urlencode "email=$Email" `
            "$BaseUrl/wp-admin/admin-post.php"
        Assert-CurlExit 'Newsletter request'
        return $sfkHeaders -join "`n"
    }

    $sfkFirstHeaders = Invoke-NewsletterPost $sfkEmail
    if ($sfkFirstHeaders -notmatch 'newsletter=success') { throw "Unexpected first newsletter response`n$sfkFirstHeaders" }

    $sfkSecondHeaders = Invoke-NewsletterPost $sfkEmail
    if ($sfkSecondHeaders -notmatch 'newsletter=exists') { throw "Newsletter deduplication failed`n$sfkSecondHeaders" }

    $sfkProductsJson = (& curl.exe -sS -L --max-time 45 -c $sfkCookiePath -b $sfkCookiePath "$BaseUrl/wp-json/wc/store/v1/products?per_page=100") -join "`n"
    Assert-CurlExit 'WooCommerce Store API request'
    $sfkProducts = $sfkProductsJson | ConvertFrom-Json

    $sfkResult = [pscustomobject]@{
        Homepage = 200
        Products = $sfkProducts.Count
        ProductImages = @($sfkProducts | Where-Object { $_.images.Count -gt 0 }).Count
        VariableProducts = @($sfkProducts | Where-Object { $_.has_options }).Count
        NewsletterStored = $true
        DuplicatePrevented = $true
        DeadFooterLinks = [regex]::Matches($sfkPageContent, 'href="#"').Count
    }

    if ($sfkResult.Products -lt 3) { throw "Expected at least 3 products, found $($sfkResult.Products)" }
    if ($sfkResult.ProductImages -ne $sfkResult.Products) { throw 'One or more products are missing images' }
    if ($sfkResult.DeadFooterLinks -ne 0) { throw 'Homepage still contains dead footer links' }
    $sfkResult | Format-List
}
finally {
    $sfkTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $sfkCookieFullPath = [IO.Path]::GetFullPath($sfkCookiePath)
    if ($sfkCookieFullPath.StartsWith($sfkTempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($sfkCookieFullPath)) {
        Remove-Item -LiteralPath $sfkCookieFullPath -Force
    }
}
