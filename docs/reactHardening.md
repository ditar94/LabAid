# React Hardening Plan

Comprehensive audit and remediation of React patterns in the LabAid frontend.

## Phase 1: Critical — Rules of Hooks & Dependency Bugs

### 1. AnalyticsPage Rules of Hooks violation
- **File**: `src/pages/AnalyticsPage.tsx`
- **Issue**: `useQuery` called after conditional `return` — violates Rules of Hooks
- **Fix**: Move `useQuery` above the guard, use `enabled: isSuperAdmin`
- **Status**: DONE

### 2. BillingPage missing useEffect dependencies
- **File**: `src/pages/BillingPage.tsx`
- **Issue**: Two `useEffect` hooks with missing deps cause stale closures
- **Fix**: Add `billing`, `paymentProcessing`, `addToast`, etc. to dependency arrays
- **Status**: DONE (merged to beta in first worktree)

### 3. ScanSearchPage stale closure
- **File**: `src/pages/ScanSearchPage.tsx`
- **Issue**: `eslint-disable react-hooks/exhaustive-deps` hides a stale closure
- **Fix**: Use ref pattern (`initialBarcodeRef`) to capture barcode on mount
- **Status**: DONE (merged to beta in first worktree)

## Phase 2: Important — Unnecessary Re-renders

### 4. AuthContext value recreated every render
- **File**: `src/context/AuthContext.tsx`
- **Issue**: Context value object created inline on every render, causing all consumers to re-render
- **Fix**: Wrap handlers in `useCallback`, stabilize value with `useMemo`
- **Status**: DONE (merged to beta in first worktree)

### 5. SharedDataContext effect dependency loop
- **File**: `src/context/SharedDataContext.tsx`
- **Issue**: `selectedLab` in effect deps creates a render loop
- **Fix**: Use functional `setState(prev => ...)` to avoid reading `selectedLab` in deps
- **Status**: DONE (merged to beta in first worktree)

### 6. DashboardPage unmemoized Maps
- **File**: `src/pages/DashboardPage.tsx`
- **Issue**: `fluoroMap` and `antibodyMap` rebuilt every render (O(n) each)
- **Fix**: Wrap in `useMemo`
- **Status**: DONE (merged to beta in first worktree)

### 7. DashboardPage inline Set
- **File**: `src/pages/DashboardPage.tsx`
- **Issue**: `new Set(tempSelectedItem.vial_ids)` created inline in JSX
- **Fix**: Extract to memoized `tempHighlightVialIds`
- **Status**: DONE (merged to beta in first worktree)

### 8. StorageGrid issues
- **File**: `src/components/storage/StorageGrid.tsx`
- **Issue**: Raw `window.matchMedia` instead of `useMediaQuery`, unmemoized `cellMap`/`fluoroMap`
- **Fix**: Use `useMediaQuery` hook, wrap maps in `useMemo`
- **Status**: DONE (merged to beta in first worktree)

### 9. CocktailRecipeForm unmemoized callback
- **File**: `src/components/CocktailRecipeForm.tsx`
- **Issue**: `getAvailableAntibodies` recreated every render
- **Fix**: Wrap in `useCallback`
- **Status**: DONE (merged to beta in first worktree)

## Phase 3: Important — Data Fetching & Race Conditions

### 10. InventoryPage manual data fetching
- **File**: `src/pages/InventoryPage.tsx`
- **Issue**: Manual `useEffect` + `useState` for antibodies/lots; no cache sharing with DashboardPage
- **Fix**: Migrate to TanStack Query with shared query keys
- **Status**: DONE (merged to beta in first worktree)

### 11. GlobalSearchPage race condition
- **File**: `src/pages/GlobalSearchPage.tsx`
- **Issue**: No AbortController — fast typing can show results for outdated queries
- **Fix**: Add `AbortController` to debounced fetch effect
- **Status**: DONE (merged to beta in first worktree)

### 12. DemoPage double-call
- **File**: `src/pages/DemoPage.tsx`
- **Issue**: `labActionItems` called twice
- **Fix**: Use IIFE pattern for single call
- **Status**: DONE (merged to beta in first worktree)

## Phase 4: Important — Type Safety & Code Quality

### 13. ReportsPage `any` types
- **File**: `src/pages/ReportsPage.tsx`
- **Issue**: `preview` state typed as `any`, report rows untyped
- **Fix**: Add `PreviewData` interface and `ReportRow` type with proper narrowing
- **Status**: DONE

### 14. Duplicate `formatDateTime` utility
- **Files**: `src/pages/DemoPage.tsx`, `src/pages/CocktailsPage.tsx`
- **Issue**: Local `formatDateTime` duplicates `utils/format.ts`
- **Fix**: Consolidate to shared import (note: CocktailsPage version intentionally different for timezone handling)
- **Status**: DONE (merged to beta in first worktree)

### 15. Layout.tsx getFullYear()
- **File**: `src/components/Layout.tsx`
- **Issue**: `new Date().getFullYear()` called every render
- **Fix**: Extract to module-level constant `CURRENT_YEAR`
- **Status**: DONE

## Phase 5: Suggestions — Code Organization

### 16. Extract shared useFluoroMap hook
- **Files**: `src/pages/DashboardPage.tsx`, `src/pages/ScanSearchPage.tsx`, `src/components/storage/StorageGrid.tsx`
- **Issue**: Identical `fluoroMap` construction repeated in 3 files
- **Fix**: Create `src/hooks/useFluoroMap.ts` and replace all usages
- **Status**: DONE

### 17. Decompose InventoryPage (1770 → 1531 lines)
- **File**: `src/pages/InventoryPage.tsx`
- **Issue**: 1770-line file with embedded DocumentModal component
- **Fix**: Extract `DocumentModal` to `src/components/DocumentModal.tsx` (-239 lines)
- **Status**: DONE

### 18. Decompose ScanSearchPage (1628 → 1417 lines)
- **File**: `src/pages/ScanSearchPage.tsx`
- **Issue**: 1628-line file with embedded cocktail scan result rendering
- **Fix**: Extract `CocktailScanResult` to `src/components/CocktailScanResult.tsx` (-211 lines)
- **Status**: DONE
