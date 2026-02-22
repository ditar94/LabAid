-- BETA DATABASE CLEANUP SQL
-- Run this against the beta database to clear test data
-- This preserves Labs, Users, and Storage Units

-- Delete in order of dependencies (most dependent first)

-- Clear vials
DELETE FROM vials;

-- Clear cocktail data
DELETE FROM cocktail_lot_sources;
DELETE FROM cocktail_lots;
DELETE FROM cocktail_recipe_components;
DELETE FROM cocktail_recipes;

-- Clear lots and requests
DELETE FROM lots;
DELETE FROM lot_requests;

-- Clear antibodies and components
DELETE FROM reagent_components;
DELETE FROM antibodies;

-- Clear fluorochromes
DELETE FROM fluorochromes;

-- Clear audit log
DELETE FROM audit_log;

-- Clear shared vendor catalog (community data)
DELETE FROM vendor_catalog;

-- Clear vial references from storage cells (keep the cells themselves)
UPDATE storage_cells SET vial_id = NULL;

-- Verify counts after cleanup
SELECT 'Remaining rows after cleanup:' AS status;
SELECT 'labs' AS table_name, COUNT(*) AS count FROM labs
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'storage_units', COUNT(*) FROM storage_units
UNION ALL SELECT 'antibodies', COUNT(*) FROM antibodies
UNION ALL SELECT 'lots', COUNT(*) FROM lots
UNION ALL SELECT 'vials', COUNT(*) FROM vials
UNION ALL SELECT 'vendor_catalog', COUNT(*) FROM vendor_catalog;
