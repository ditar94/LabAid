"""Tests for GS1 DataMatrix barcode parser."""

from datetime import date

import pytest

from app.services.gs1_parser import (
    GS,
    extract_fields,
    normalize_barcode,
    parse_gs1,
)


class TestNormalizeBarcode:
    def test_strips_whitespace(self):
        assert normalize_barcode("  01012345  ") == "01012345"

    def test_strips_cr_lf(self):
        assert normalize_barcode("01012345\r\n") == "01012345"

    def test_strips_symbology_prefix_d2(self):
        assert normalize_barcode("]d201012345") == "01012345"

    def test_strips_symbology_prefix_c1(self):
        assert normalize_barcode("]C101012345") == "01012345"

    def test_strips_symbology_prefix_e0(self):
        assert normalize_barcode("]e001012345") == "01012345"

    def test_replaces_gs_placeholder_braces(self):
        assert normalize_barcode("ABC{GS}DEF") == f"ABC{GS}DEF"

    def test_replaces_gs_placeholder_angle_brackets(self):
        assert normalize_barcode("ABC<GS>DEF") == f"ABC{GS}DEF"

    def test_replaces_unicode_gs_symbol(self):
        assert normalize_barcode("ABC\u241dDEF") == f"ABC{GS}DEF"

    def test_combined_normalization(self):
        raw = "  ]d2ABC{GS}DEF\r\n"
        result = normalize_barcode(raw)
        assert result == f"ABC{GS}DEF"


class TestParseGS1:
    def test_gtin_only(self):
        barcode = "0100888888888888"
        result = parse_gs1(barcode)
        assert result == {"01": "00888888888888"}

    def test_gtin_with_expiration_and_lot(self):
        # GTIN (14 fixed) + expiration (6 fixed) + lot (variable, at end)
        barcode = "010088888888888817261231" + "10ABC123"
        result = parse_gs1(barcode)
        assert result == {
            "01": "00888888888888",
            "17": "261231",
            "10": "ABC123",
        }

    def test_variable_length_with_gs_separator(self):
        # Lot (variable) + GS + serial (variable)
        barcode = f"10LOT456{GS}21SER789"
        result = parse_gs1(barcode)
        assert result == {"10": "LOT456", "21": "SER789"}

    def test_multiple_variable_ais_with_gs(self):
        # Lot + GS + additional product ID + GS + serial
        barcode = f"10BATCH99{GS}240CAT-001{GS}21SERIAL1"
        result = parse_gs1(barcode)
        assert result == {
            "10": "BATCH99",
            "240": "CAT-001",
            "21": "SERIAL1",
        }

    def test_full_barcode_with_all_supported_ais(self):
        # GTIN + production date + expiration + lot(GS) + serial(GS) + additional ID
        barcode = (
            "01008888888888881126010117261231"
            + f"10LOT-A{GS}21SN001{GS}240PART-X"
        )
        result = parse_gs1(barcode)
        assert result["01"] == "00888888888888"
        assert result["11"] == "260101"
        assert result["17"] == "261231"
        assert result["10"] == "LOT-A"
        assert result["21"] == "SN001"
        assert result["240"] == "PART-X"

    def test_not_gs1_returns_empty(self):
        result = parse_gs1("NOTAGS1BARCODE")
        assert result == {}

    def test_empty_string_returns_empty(self):
        assert parse_gs1("") == {}

    def test_whitespace_only_returns_empty(self):
        assert parse_gs1("   \r\n") == {}

    def test_symbology_prefix_stripped_before_parse(self):
        barcode = "]d20100888888888888"
        result = parse_gs1(barcode)
        assert result == {"01": "00888888888888"}

    def test_scanner_cr_lf_stripped(self):
        barcode = "0100888888888888\r\n"
        result = parse_gs1(barcode)
        assert result == {"01": "00888888888888"}

    def test_gs_placeholder_handled(self):
        barcode = "10LOT123{GS}21SER456"
        result = parse_gs1(barcode)
        assert result == {"10": "LOT123", "21": "SER456"}

    def test_partial_parse_returns_what_it_can(self):
        # Valid GTIN followed by unknown data
        barcode = "0100888888888888ZZZZZZ"
        result = parse_gs1(barcode)
        assert result.get("01") == "00888888888888"

    def test_three_digit_ai_not_confused_with_two_digit(self):
        # AI 240 should NOT be parsed as AI 24 (which doesn't exist) + 0...
        barcode = f"10LOT{GS}240CATALOG123"
        result = parse_gs1(barcode)
        assert "240" in result
        assert result["240"] == "CATALOG123"

    def test_ai_with_gs_between_fixed_length_ais(self):
        # GS between two fixed-length AIs (should be skipped gracefully)
        barcode = f"0100888888888888{GS}17261231"
        result = parse_gs1(barcode)
        assert result["01"] == "00888888888888"
        assert result["17"] == "261231"



class TestExtractFields:
    def test_full_extraction(self):
        parsed = {
            "01": "00888888888888",
            "10": "LOT-42",
            "17": "261231",
            "21": "SN001",
            "240": "CAT-99",
            "11": "260101",
        }
        fields = extract_fields(parsed)
        assert fields["gtin"] == "00888888888888"
        assert fields["lot_number"] == "LOT-42"
        assert fields["expiration_date"] == date(2026, 12, 31)
        assert fields["serial"] == "SN001"
        assert fields["catalog_number"] == "CAT-99"
        assert fields["production_date"] == date(2026, 1, 1)
        assert fields["all_ais"] == parsed

    def test_missing_fields_are_none(self):
        parsed = {"01": "00888888888888"}
        fields = extract_fields(parsed)
        assert fields["gtin"] == "00888888888888"
        assert fields["lot_number"] is None
        assert fields["expiration_date"] is None
        assert fields["serial"] is None
        assert fields["catalog_number"] is None
        assert fields["production_date"] is None

    def test_empty_parsed_returns_all_none(self):
        fields = extract_fields({})
        assert fields["gtin"] is None
        assert fields["all_ais"] is None

    def test_expiration_day_00_becomes_end_of_month(self):
        parsed = {"17": "260200"}  # Feb 2026, day 00
        fields = extract_fields(parsed)
        assert fields["expiration_date"] == date(2026, 2, 28)

    def test_expiration_day_00_leap_year(self):
        parsed = {"17": "240200"}  # Feb 2024, day 00 (leap year)
        fields = extract_fields(parsed)
        assert fields["expiration_date"] == date(2024, 2, 29)

    def test_invalid_date_returns_none(self):
        parsed = {"17": "261332"}  # Month 13 is invalid
        fields = extract_fields(parsed)
        assert fields["expiration_date"] is None

    def test_non_numeric_date_returns_none(self):
        parsed = {"17": "ABCDEF"}
        fields = extract_fields(parsed)
        assert fields["expiration_date"] is None

    def test_short_date_returns_none(self):
        parsed = {"17": "2612"}  # Too short
        fields = extract_fields(parsed)
        assert fields["expiration_date"] is None
