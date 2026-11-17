param([string]$Repository = 'Chigland/SGVC')

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE)." }
}

if ($Repository -ne 'Chigland/SGVC') {
    throw 'This release is configured for Chigland/SGVC. Update the paper URL and site metadata before choosing another repository.'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath "$PSScriptRoot/.preview/gh/bin/gh.exe")) {
    $env:PATH = "$PSScriptRoot/.preview/gh/bin;$env:PATH"
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is required. Install it from https://cli.github.com/ , then run gh auth login --hostname github.com and rerun this script.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }

$login = & gh api user --jq .login
if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login --hostname github.com and sign in as Chigland, then rerun this script.' }
if ($login.Trim() -cne 'Chigland') { throw "Authenticated as $login. Run gh auth switch --hostname github.com --user Chigland first." }

Invoke-Checked 'gh' @('auth', 'setup-git', '--hostname', 'github.com')
if (-not (Test-Path -LiteralPath '.git')) {
    Invoke-Checked 'git' @('init', '-b', 'gh-pages')
}
$origin = & git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $origin -notin @('https://github.com/Chigland/SGVC.git', 'https://github.com/Chigland/SGVC', 'git@github.com:Chigland/SGVC.git')) {
    throw "Unexpected origin: $origin. No remote was changed."
}

$repoJson = & gh repo view $Repository --json nameWithOwner,isPrivate 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'The existing Chigland/SGVC repository could not be accessed. Check authentication and repository access; this script never creates a repository.'
}
$repoInfo = $repoJson | ConvertFrom-Json
if ($repoInfo.nameWithOwner -cne $Repository) { throw 'GitHub returned a different repository. Nothing was pushed.' }
if ($repoInfo.isPrivate) { throw 'The existing repository is private. Its visibility was not changed.' }
if (-not $origin) { Invoke-Checked 'git' @('remote', 'add', 'origin', 'https://github.com/Chigland/SGVC.git') }

Invoke-Checked 'git' @('add', '--all')
& git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
    Invoke-Checked 'git' @('commit', '-m', 'Publish SGVC project page and synchronized reconstruction comparisons')
} elseif ($LASTEXITCODE -ne 0) { throw 'Unable to inspect staged changes.' }
$remoteBranch = & git ls-remote --exit-code --heads origin refs/heads/gh-pages
$remoteStatus = $LASTEXITCODE
if ($remoteStatus -eq 0) {
    Invoke-Checked 'git' @('fetch', 'origin', 'refs/heads/gh-pages:refs/remotes/origin/gh-pages')
    & git merge-base --is-ancestor refs/remotes/origin/gh-pages HEAD
    if ($LASTEXITCODE -eq 1) {
        throw 'Remote gh-pages is not an ancestor of local HEAD. Fetch and reconcile the histories before publishing; no force push is permitted.'
    } elseif ($LASTEXITCODE -ne 0) { throw 'Unable to check the existing gh-pages history.' }
} elseif ($remoteStatus -ne 2) { throw 'Unable to inspect the remote gh-pages branch.' }
# Explicit destination preserves the repository main branch and its code-release placeholder.
Invoke-Checked 'git' @('push', 'origin', 'HEAD:refs/heads/gh-pages')

$pagesSourceChanged = $false
$pagesResponse = & gh api "repos/$Repository/pages" 2>&1
if ($LASTEXITCODE -ne 0) {
    if (($pagesResponse | Out-String) -notmatch 'HTTP 404') {
        throw 'Unable to inspect GitHub Pages settings. The source was pushed, but Pages was not changed.'
    }
    Invoke-Checked 'gh' @('api', '--method', 'POST', "repos/$Repository/pages", '-f', 'build_type=legacy', '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/')
    $pagesSourceChanged = $true
} else {
    $pagesInfo = ($pagesResponse | Out-String) | ConvertFrom-Json
    if ($pagesInfo.source.branch -ne 'gh-pages' -or $pagesInfo.source.path -ne '/' -or $pagesInfo.build_type -ne 'legacy') {
        Invoke-Checked 'gh' @('api', '--method', 'PUT', "repos/$Repository/pages", '-f', 'build_type=legacy', '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/')
        $pagesSourceChanged = $true
    }
}
if ($pagesSourceChanged) {
    Invoke-Checked 'gh' @('api', '--method', 'POST', "repos/$Repository/pages/builds")
}
Write-Host 'Source pushed and GitHub Pages configured. Deployment may take a few minutes.'
Write-Host 'Repository: https://github.com/Chigland/SGVC'
Write-Host 'Project page: https://chigland.github.io/SGVC/'
