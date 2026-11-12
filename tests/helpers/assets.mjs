// Private, git-ignored inputs: browser/assets/recovered (the recovered game data), analysis/, site/generated and
// build/vm-test/adapter. CI (.github/workflows/test.yml) checks out the repo without them, so every test that reads them
// skips with ASSET_SKIP instead of failing. RLB_NO_ASSETS=1 makes this machine behave the same with the folders in place
// (nothing is moved): `$env:RLB_NO_ASSETS='1'; npm test` in PowerShell, `RLB_NO_ASSETS=1 npm test` in bash.
import {existsSync} from 'node:fs';

export const NO_ASSETS=process.env.RLB_NO_ASSETS==='1';
export const RECOVERED=new URL('../../browser/assets/recovered/',import.meta.url);
export const ASSET_SKIP='no recovered assets (private, git-ignored: browser/assets/recovered, analysis/, site/generated, build/vm-test/adapter)';

// A private file or folder that is there (a URL, or a path relative to the working directory, which is the repo root
// under npm test). Always false under RLB_NO_ASSETS=1.
export const present=p=>!NO_ASSETS&&existsSync(p);

// The recovered export as a whole (its root manifest).
export const hasRecovered=present(new URL('manifest.json',RECOVERED));

// Test options for a test that reads the recovered export: skipped when it is absent. withAssets() merges into a test's
// own options and keeps a skip it already has.
export const needsAssets=hasRecovered?{}:{skip:ASSET_SKIP};
export const withAssets=(opts={})=>hasRecovered||opts.skip?opts:{...opts,skip:ASSET_SKIP};

// Top-level data that comes from the export: the value when it is there, null when it is not (the tests that use it
// carry needsAssets, so they never see the null).
export const ifAssets=fn=>hasRecovered?fn():null;
