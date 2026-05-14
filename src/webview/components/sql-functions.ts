export interface SqlFunctionDef {
    name: string;
    category: string;
    insertText: string; // Monaco snippet format
    syntax: string;     // For Wiki
    doc: string;        // Description used in both Monaco and Wiki
    example?: string;   // For Wiki
    duckdbOnly?: boolean;
    pgOnly?: boolean;
}

export const SQL_FUNCTIONS: SqlFunctionDef[] = [
    // ── String Functions ──
    { name: 'CONCAT', category: 'String Functions', insertText: "CONCAT(${1:str1}, ${2:str2})", syntax: "CONCAT('A', 'B')", doc: 'Concatenates two or more strings.', example: "SELECT CONCAT('Hello', ' ', 'World');" },
    { name: 'LENGTH', category: 'String Functions', insertText: 'LENGTH(${1:string})', syntax: "LENGTH(string)", doc: 'Returns the number of characters in a string.', example: "SELECT LENGTH('Hello');\n-- 5" },
    { name: 'LOWER', category: 'String Functions', insertText: 'LOWER(${1:string})', syntax: "LOWER(string)", doc: 'Converts string to lower case.', example: "SELECT LOWER('HELLO');" },
    { name: 'UPPER', category: 'String Functions', insertText: 'UPPER(${1:string})', syntax: "UPPER(string)", doc: 'Converts string to upper case.', example: "SELECT UPPER('hello');" },
    { name: 'TRIM', category: 'String Functions', insertText: 'TRIM(${1:string})', syntax: "TRIM(string)", doc: 'Removes leading and trailing whitespace.' },
    { name: 'LTRIM', category: 'String Functions', insertText: 'LTRIM(${1:string})', syntax: "LTRIM(string)", doc: 'Removes leading whitespace.' },
    { name: 'RTRIM', category: 'String Functions', insertText: 'RTRIM(${1:string})', syntax: "RTRIM(string)", doc: 'Removes trailing whitespace.' },
    { name: 'SUBSTRING', category: 'String Functions', insertText: 'SUBSTRING(${1:string}, ${2:start}, ${3:length})', syntax: "SUBSTRING(string, start, length)", doc: 'Extracts a substring.', example: "SELECT SUBSTRING('Database', 1, 4);" },
    { name: 'REPLACE', category: 'String Functions', insertText: "REPLACE(${1:string}, ${2:from}, ${3:to})", syntax: "REPLACE(string, from, to)", doc: 'Replaces all occurrences of a substring.', example: "SELECT REPLACE('Hello World', 'World', 'Postgres');" },
    { name: 'SPLIT_PART', category: 'String Functions', insertText: "SPLIT_PART(${1:string}, ${2:delimiter}, ${3:position})", syntax: "SPLIT_PART(string, delimiter, pos)", doc: 'Splits string by delimiter and returns the given field.' },
    { name: 'LEFT', category: 'String Functions', insertText: 'LEFT(${1:string}, ${2:n})', syntax: "LEFT(string, n)", doc: 'Returns first n characters of string.' },
    { name: 'RIGHT', category: 'String Functions', insertText: 'RIGHT(${1:string}, ${2:n})', syntax: "RIGHT(string, n)", doc: 'Returns last n characters of string.' },
    { name: 'REVERSE', category: 'String Functions', insertText: 'REVERSE(${1:string})', syntax: "REVERSE(string)", doc: 'Reverses the characters in a string.' },
    { name: 'REPEAT', category: 'String Functions', insertText: 'REPEAT(${1:string}, ${2:n})', syntax: "REPEAT(string, n)", doc: 'Repeats string n times.' },
    { name: 'LPAD', category: 'String Functions', insertText: "LPAD(${1:string}, ${2:length}, ${3:fill})", syntax: "LPAD(string, length, fill)", doc: 'Pads string on the left to given length.' },
    { name: 'RPAD', category: 'String Functions', insertText: "RPAD(${1:string}, ${2:length}, ${3:fill})", syntax: "RPAD(string, length, fill)", doc: 'Pads string on the right to given length.' },
    { name: 'INITCAP', category: 'String Functions', insertText: 'INITCAP(${1:string})', syntax: "INITCAP(string)", doc: 'Capitalizes the first letter of each word.' },
    { name: 'REGEXP_REPLACE', category: 'String Functions', insertText: "REGEXP_REPLACE(${1:string}, ${2:pattern}, ${3:replacement})", syntax: "REGEXP_REPLACE(string, pattern, replacement)", doc: 'Replaces substrings matching a regex pattern.' },
    { name: 'REGEXP_MATCHES', category: 'String Functions', insertText: "REGEXP_MATCHES(${1:string}, ${2:pattern})", syntax: "REGEXP_MATCHES(string, pattern)", doc: 'Returns all captured substrings matching a regex.', pgOnly: true },
    { name: 'REGEXP_EXTRACT', category: 'String Functions', insertText: "REGEXP_EXTRACT(${1:string}, ${2:pattern}, ${3:group})", syntax: "REGEXP_EXTRACT(string, pattern, group)", doc: 'Extracts substring matching regex group.', duckdbOnly: true, example: "SELECT regexp_extract('abc', 'b(c)', 1);" },
    { name: 'POSITION', category: 'String Functions', insertText: "POSITION(${1:substring} IN ${2:string})", syntax: "POSITION(substring IN string)", doc: 'Returns position of substring.' },

    // ── Numeric Functions ──
    { name: 'ABS', category: 'Numeric Functions', insertText: 'ABS(${1:value})', syntax: "ABS(numeric)", doc: 'Absolute value.', example: "SELECT ABS(-17.4);" },
    { name: 'ROUND', category: 'Numeric Functions', insertText: 'ROUND(${1:value}, ${2:decimals})', syntax: "ROUND(numeric, decimals)", doc: 'Rounds to given decimal places.', example: "SELECT ROUND(42.4382, 2);" },
    { name: 'CEIL', category: 'Numeric Functions', insertText: 'CEIL(${1:value})', syntax: "CEIL(numeric)", doc: 'Rounds up to the nearest integer.', example: "SELECT CEIL(42.8);" },
    { name: 'FLOOR', category: 'Numeric Functions', insertText: 'FLOOR(${1:value})', syntax: "FLOOR(numeric)", doc: 'Rounds down to the nearest integer.' },
    { name: 'MOD', category: 'Numeric Functions', insertText: 'MOD(${1:dividend}, ${2:divisor})', syntax: "MOD(dividend, divisor)", doc: 'Returns the remainder of division.' },
    { name: 'POWER', category: 'Numeric Functions', insertText: 'POWER(${1:base}, ${2:exponent})', syntax: "POWER(base, exponent)", doc: 'Raises a number to a power.' },
    { name: 'SQRT', category: 'Numeric Functions', insertText: 'SQRT(${1:value})', syntax: "SQRT(numeric)", doc: 'Square root.' },
    { name: 'LN', category: 'Numeric Functions', insertText: 'LN(${1:value})', syntax: "LN(numeric)", doc: 'Natural logarithm.' },
    { name: 'LOG', category: 'Numeric Functions', insertText: 'LOG(${1:value})', syntax: "LOG(numeric)", doc: 'Base-10 logarithm.' },
    { name: 'SIGN', category: 'Numeric Functions', insertText: 'SIGN(${1:value})', syntax: "SIGN(numeric)", doc: 'Returns -1, 0, or 1.' },
    { name: 'RANDOM', category: 'Numeric Functions', insertText: 'RANDOM()', syntax: "RANDOM()", doc: 'Returns a random value between 0.0 and 1.0.', example: "SELECT RANDOM();" },
    { name: 'GREATEST', category: 'Numeric Functions', insertText: 'GREATEST(${1:val1}, ${2:val2})', syntax: "GREATEST(val1, val2)", doc: 'Returns the largest value among arguments.' },
    { name: 'LEAST', category: 'Numeric Functions', insertText: 'LEAST(${1:val1}, ${2:val2})', syntax: "LEAST(val1, val2)", doc: 'Returns the smallest value among arguments.' },

    // ── Date/Time Functions ──
    { name: 'NOW', category: 'Date/Time Functions', insertText: 'NOW()', syntax: "NOW()", doc: 'Returns the current date and time.', example: "SELECT NOW();" },
    { name: 'CURRENT_DATE', category: 'Date/Time Functions', insertText: 'CURRENT_DATE', syntax: "CURRENT_DATE", doc: 'Returns the current date.', example: "SELECT CURRENT_DATE;" },
    { name: 'CURRENT_TIMESTAMP', category: 'Date/Time Functions', insertText: 'CURRENT_TIMESTAMP', syntax: "CURRENT_TIMESTAMP", doc: 'Returns the current timestamp.' },
    { name: 'DATE_TRUNC', category: 'Date/Time Functions', insertText: "DATE_TRUNC(${1:'month'}, ${2:column})", syntax: "DATE_TRUNC('month', timestamp)", doc: 'Truncates timestamp to specified precision.', example: "SELECT DATE_TRUNC('month', NOW());" },
    { name: 'DATE_PART', category: 'Date/Time Functions', insertText: "DATE_PART(${1:'year'}, ${2:column})", syntax: "DATE_PART('year', timestamp)", doc: 'Extracts a subfield from a date/time value.' },
    { name: 'EXTRACT', category: 'Date/Time Functions', insertText: "EXTRACT(${1:year} FROM ${2:column})", syntax: "EXTRACT(field FROM source)", doc: 'Extracts a subfield from a date/time value.', example: "SELECT EXTRACT(year FROM NOW());" },
    { name: 'AGE', category: 'Date/Time Functions', insertText: 'AGE(${1:timestamp1}, ${2:timestamp2})', syntax: "AGE(timestamp, timestamp)", doc: 'Subtracts timestamps, returns interval.', pgOnly: true, example: "SELECT AGE(TIMESTAMP '2001-04-10', TIMESTAMP '1957-06-13');" },
    { name: 'DATE_ADD', category: 'Date/Time Functions', insertText: "DATE_ADD(${1:date}, INTERVAL ${2:1} ${3:MONTH})", syntax: "DATE_ADD(date, INTERVAL 1 MONTH)", doc: 'Adds interval to date.', duckdbOnly: true, example: "SELECT DATE_ADD(CURRENT_DATE, INTERVAL 1 MONTH);" },
    { name: 'DATE_SUB', category: 'Date/Time Functions', insertText: "DATE_SUB(${1:date}, INTERVAL ${2:1} ${3:MONTH})", syntax: "DATE_SUB(date, INTERVAL 1 MONTH)", doc: 'Subtracts interval from date.', duckdbOnly: true },
    { name: 'DATE_DIFF', category: 'Date/Time Functions', insertText: "DATE_DIFF(${1:'day'}, ${2:start}, ${3:end})", syntax: "DATE_DIFF('day', start, end)", doc: 'Returns the difference between two dates.', duckdbOnly: true },
    { name: 'STRFTIME', category: 'Date/Time Functions', insertText: "STRFTIME(${1:timestamp}, ${2:'%Y-%m-%d'})", syntax: "STRFTIME(timestamp, format)", doc: 'Formats timestamp as string.', duckdbOnly: true },
    { name: 'EPOCH', category: 'Date/Time Functions', insertText: 'EPOCH(${1:timestamp})', syntax: "EPOCH(timestamp)", doc: 'Converts timestamp to unix epoch seconds.', duckdbOnly: true, example: "SELECT EPOCH(NOW());" },
    { name: 'MAKE_TIMESTAMP', category: 'Date/Time Functions', insertText: 'MAKE_TIMESTAMP(${1:year}, ${2:month}, ${3:day}, ${4:hour}, ${5:min}, ${6:sec})', syntax: "MAKE_TIMESTAMP(year, month, day, hour, min, sec)", doc: 'Creates timestamp from parts.', duckdbOnly: true, example: "SELECT MAKE_TIMESTAMP(1992, 9, 20, 13, 53, 20);" },
    { name: 'TO_CHAR', category: 'Date/Time Functions', insertText: "TO_CHAR(${1:value}, ${2:'format'})", syntax: "TO_CHAR(value, format)", doc: 'Converts value to string with format.', pgOnly: true },
    { name: 'TO_DATE', category: 'Date/Time Functions', insertText: "TO_DATE(${1:string}, ${2:'YYYY-MM-DD'})", syntax: "TO_DATE(string, format)", doc: 'Converts string to date.', pgOnly: true },
    { name: 'MAKE_DATE', category: 'Date/Time Functions', insertText: 'MAKE_DATE(${1:year}, ${2:month}, ${3:day})', syntax: "MAKE_DATE(year, month, day)", doc: 'Creates date from year/month/day parts.' },

    // ── Aggregations ──
    { name: 'COUNT', category: 'Aggregations', insertText: 'COUNT(${1:*})', syntax: "COUNT(*)", doc: 'Returns the number of input rows.', example: "SELECT COUNT(*) FROM users;" },
    { name: 'SUM', category: 'Aggregations', insertText: 'SUM(${1:column})', syntax: "SUM(column)", doc: 'Returns the sum of all input values.' },
    { name: 'AVG', category: 'Aggregations', insertText: 'AVG(${1:column})', syntax: "AVG(column)", doc: 'Returns the average of all input values.' },
    { name: 'MIN', category: 'Aggregations', insertText: 'MIN(${1:column})', syntax: "MIN(column)", doc: 'Returns the minimum value.' },
    { name: 'MAX', category: 'Aggregations', insertText: 'MAX(${1:column})', syntax: "MAX(column)", doc: 'Returns the maximum value.' },
    { name: 'STRING_AGG', category: 'Aggregations', insertText: "STRING_AGG(${1:column}, ${2:', '})", syntax: "STRING_AGG(column, ', ')", doc: 'Concatenates values into a string with delimiter.', example: "SELECT STRING_AGG(name, ', ') FROM users;" },
    { name: 'ARRAY_AGG', category: 'Aggregations', insertText: 'ARRAY_AGG(${1:column})', syntax: "ARRAY_AGG(column)", doc: 'Collects values into an array.', pgOnly: true, example: "SELECT ARRAY_AGG(id) FROM users;" },
    { name: 'LIST_AGGREGATE', category: 'Aggregations', insertText: "LIST_AGGREGATE(${1:list}, ${2:'sum'})", syntax: "LIST_AGGREGATE(list, 'sum')", doc: 'Aggregates elements of a list.', duckdbOnly: true, example: "SELECT LIST_AGGREGATE([1,2,3], 'sum');" },
    { name: 'BOOL_AND', category: 'Aggregations', insertText: 'BOOL_AND(${1:column})', syntax: "BOOL_AND(column)", doc: 'Returns TRUE if all input values are true.' },
    { name: 'BOOL_OR', category: 'Aggregations', insertText: 'BOOL_OR(${1:column})', syntax: "BOOL_OR(column)", doc: 'Returns TRUE if any input value is true.' },
    { name: 'PERCENTILE_CONT', category: 'Aggregations', insertText: 'PERCENTILE_CONT(${1:0.5}) WITHIN GROUP (ORDER BY ${2:column})', syntax: "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY col)", doc: 'Continuous percentile: returns interpolated value.' },
    { name: 'PERCENTILE_DISC', category: 'Aggregations', insertText: 'PERCENTILE_DISC(${1:0.5}) WITHIN GROUP (ORDER BY ${2:column})', syntax: "PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY col)", doc: 'Discrete percentile: returns existing value.' },
    { name: 'MODE', category: 'Aggregations', insertText: 'MODE() WITHIN GROUP (ORDER BY ${1:column})', syntax: "MODE() WITHIN GROUP (ORDER BY col)", doc: 'Returns the most frequent value.' },

    // ── Conditional / Logic ──
    { name: 'COALESCE', category: 'Conditional / Logic', insertText: 'COALESCE(${1:val1}, ${2:val2})', syntax: "COALESCE(val1, val2)", doc: 'Returns the first non-null argument.', example: "SELECT COALESCE(description, 'No description');" },
    { name: 'NULLIF', category: 'Conditional / Logic', insertText: 'NULLIF(${1:val1}, ${2:val2})', syntax: "NULLIF(val1, val2)", doc: 'Returns NULL if val1 equals val2.' },
    { name: 'CASE', category: 'Conditional / Logic', insertText: 'CASE WHEN ${1:condition} THEN ${2:result} ELSE ${3:default} END', syntax: "CASE WHEN ... THEN ... END", doc: 'Conditional expression.' },
    { name: 'IF', category: 'Conditional / Logic', insertText: 'IF(${1:condition}, ${2:true_val}, ${3:false_val})', syntax: "IF(condition, true_val, false_val)", doc: 'Returns true_val if condition is true, else false_val.', duckdbOnly: true },
    { name: 'IIF', category: 'Conditional / Logic', insertText: 'IIF(${1:condition}, ${2:true_val}, ${3:false_val})', syntax: "IIF(condition, true_val, false_val)", doc: 'Returns true_val if condition is true, else false_val.', duckdbOnly: true },

    // ── Window Functions ──
    { name: 'ROW_NUMBER', category: 'Window Functions', insertText: 'ROW_NUMBER() OVER (${1:ORDER BY column})', syntax: "ROW_NUMBER() OVER (...)", doc: 'Sequential row number within partition.' },
    { name: 'RANK', category: 'Window Functions', insertText: 'RANK() OVER (${1:ORDER BY column})', syntax: "RANK() OVER (...)", doc: 'Rank with gaps for ties.' },
    { name: 'DENSE_RANK', category: 'Window Functions', insertText: 'DENSE_RANK() OVER (${1:ORDER BY column})', syntax: "DENSE_RANK() OVER (...)", doc: 'Rank without gaps for ties.' },
    { name: 'NTILE', category: 'Window Functions', insertText: 'NTILE(${1:n}) OVER (${2:ORDER BY column})', syntax: "NTILE(n) OVER (...)", doc: 'Divides rows into n roughly equal buckets.' },
    { name: 'LAG', category: 'Window Functions', insertText: 'LAG(${1:column}, ${2:1}) OVER (${3:ORDER BY column})', syntax: "LAG(column, offset) OVER (...)", doc: 'Returns value from previous row.' },
    { name: 'LEAD', category: 'Window Functions', insertText: 'LEAD(${1:column}, ${2:1}) OVER (${3:ORDER BY column})', syntax: "LEAD(column, offset) OVER (...)", doc: 'Returns value from next row.' },
    { name: 'FIRST_VALUE', category: 'Window Functions', insertText: 'FIRST_VALUE(${1:column}) OVER (${2:ORDER BY column})', syntax: "FIRST_VALUE(column) OVER (...)", doc: 'Returns the first value in the window frame.' },
    { name: 'LAST_VALUE', category: 'Window Functions', insertText: 'LAST_VALUE(${1:column}) OVER (${2:ORDER BY column})', syntax: "LAST_VALUE(column) OVER (...)", doc: 'Returns the last value in the window frame.' },
    { name: 'NTH_VALUE', category: 'Window Functions', insertText: 'NTH_VALUE(${1:column}, ${2:n}) OVER (${3:ORDER BY column})', syntax: "NTH_VALUE(column, n) OVER (...)", doc: 'Returns the n-th value in the window frame.' },

    // ── JSON Functions ──
    { name: 'JSON_EXTRACT', category: 'JSON Functions', insertText: "JSON_EXTRACT(${1:column}, ${2:'\\$.key'})", syntax: "JSON_EXTRACT(json, path)", doc: 'Extracts value from JSON by path.', duckdbOnly: true },
    { name: 'JSON_EXTRACT_STRING', category: 'JSON Functions', insertText: "JSON_EXTRACT_STRING(${1:column}, ${2:'\\$.key'})", syntax: "JSON_EXTRACT_STRING(json, path)", doc: 'Extracts string from JSON by path.', duckdbOnly: true },
    { name: 'JSON_ARRAY_LENGTH', category: 'JSON Functions', insertText: 'JSON_ARRAY_LENGTH(${1:json})', syntax: "JSON_ARRAY_LENGTH(json)", doc: 'Returns the length of a JSON array.', duckdbOnly: true },
    { name: 'JSON_BUILD_OBJECT', category: 'JSON Functions', insertText: "JSON_BUILD_OBJECT(${1:'key'}, ${2:value})", syntax: "JSON_BUILD_OBJECT(key, value, ...)", doc: 'Builds a JSON object from key/value pairs.' },
    { name: 'JSON_AGG', category: 'JSON Functions', insertText: 'JSON_AGG(${1:column})', syntax: "JSON_AGG(column)", doc: 'Aggregates values into a JSON array.', pgOnly: true },
    { name: 'JSONB_PRETTY', category: 'JSON Functions', insertText: 'JSONB_PRETTY(${1:jsonb})', syntax: "JSONB_PRETTY(jsonb)", doc: 'Pretty-prints JSONB value.', pgOnly: true },

    // ── Type Casting ──
    { name: 'CAST', category: 'Type Casting', insertText: 'CAST(${1:value} AS ${2:type})', syntax: "CAST(value AS type)", doc: 'Converts a value to a specified data type.' },
    { name: 'TRY_CAST', category: 'Type Casting', insertText: 'TRY_CAST(${1:value} AS ${2:type})', syntax: "TRY_CAST(value AS type)", doc: 'Converts a value to a type, returns NULL on failure.', duckdbOnly: true },

    // ── DuckDB File Functions ──
    { name: 'READ_CSV_AUTO', category: 'Files & JSON', insertText: "READ_CSV_AUTO(${1:'file.csv'})", syntax: "SELECT * FROM READ_CSV_AUTO('file.csv')", doc: 'Auto-detects and reads CSV files.', duckdbOnly: true, example: "SELECT * FROM read_csv_auto('data.csv');" },
    { name: 'READ_CSV', category: 'Files & JSON', insertText: "READ_CSV(${1:'file.csv'})", syntax: "SELECT * FROM READ_CSV('file.csv')", doc: 'Reads CSV files with explicit options.', duckdbOnly: true },
    { name: 'READ_PARQUET', category: 'Files & JSON', insertText: "READ_PARQUET(${1:'file.parquet'})", syntax: "SELECT * FROM READ_PARQUET('file.parquet')", doc: 'Reads Apache Parquet files natively.', duckdbOnly: true, example: "SELECT * FROM read_parquet('data.parquet');" },
    { name: 'READ_JSON_AUTO', category: 'Files & JSON', insertText: "READ_JSON_AUTO(${1:'file.json'})", syntax: "SELECT * FROM READ_JSON_AUTO('file.json')", doc: 'Auto-detects and reads JSON files.', duckdbOnly: true, example: "SELECT * FROM read_json_auto('data.json');" },
    { name: 'READ_JSON', category: 'Files & JSON', insertText: "READ_JSON(${1:'file.json'})", syntax: "SELECT * FROM READ_JSON('file.json')", doc: 'Reads JSON files with explicit options.', duckdbOnly: true },
    { name: 'ST_READ', category: 'Files & JSON', insertText: "ST_READ(${1:'file.shp'})", syntax: "SELECT * FROM ST_READ('file.shp')", doc: 'Reads geospatial files (requires spatial extension).', duckdbOnly: true },

    // ── Views & Materialized Views ──
    { name: 'CREATE VIEW', category: 'Views & Materialized Views', insertText: 'CREATE VIEW ${1:view_name} AS\n${2:SELECT * FROM table_name};', syntax: "CREATE VIEW view_name AS SELECT ...", doc: 'Creates a virtual table based on a query. Does not store data — re-runs the query each time.', example: "CREATE VIEW active_users AS\nSELECT * FROM users WHERE active = true;" },
    { name: 'CREATE OR REPLACE VIEW', category: 'Views & Materialized Views', insertText: 'CREATE OR REPLACE VIEW ${1:view_name} AS\n${2:SELECT * FROM table_name};', syntax: "CREATE OR REPLACE VIEW view_name AS SELECT ...", doc: 'Creates or replaces an existing view. Safer than DROP + CREATE — preserves dependent objects.', example: "CREATE OR REPLACE VIEW active_users AS\nSELECT id, name, email FROM users WHERE active = true;" },
    { name: 'CREATE MATERIALIZED VIEW', category: 'Views & Materialized Views', insertText: 'CREATE MATERIALIZED VIEW ${1:view_name} AS\n${2:SELECT * FROM table_name};', syntax: "CREATE MATERIALIZED VIEW view_name AS SELECT ...", doc: 'Creates a view that stores query results physically. Must be refreshed manually to get new data.', pgOnly: true, example: "CREATE MATERIALIZED VIEW monthly_stats AS\nSELECT date_trunc('month', created_at) AS month, COUNT(*)\nFROM orders GROUP BY 1;" },
    { name: 'CREATE MATERIALIZED VIEW IF NOT EXISTS', category: 'Views & Materialized Views', insertText: 'CREATE MATERIALIZED VIEW IF NOT EXISTS ${1:view_name} AS\n${2:SELECT * FROM table_name};', syntax: "CREATE MATERIALIZED VIEW IF NOT EXISTS view_name AS ...", doc: 'Creates materialized view only if it doesn\'t already exist. Avoids errors on re-run.', pgOnly: true },
    { name: 'REFRESH MATERIALIZED VIEW', category: 'Views & Materialized Views', insertText: 'REFRESH MATERIALIZED VIEW ${1:view_name};', syntax: "REFRESH MATERIALIZED VIEW view_name", doc: 'Re-runs the materialized view query and updates stored data. Locks the view during refresh.', pgOnly: true, example: "REFRESH MATERIALIZED VIEW monthly_stats;" },
    { name: 'REFRESH MATERIALIZED VIEW CONCURRENTLY', category: 'Views & Materialized Views', insertText: 'REFRESH MATERIALIZED VIEW CONCURRENTLY ${1:view_name};', syntax: "REFRESH MATERIALIZED VIEW CONCURRENTLY view_name", doc: 'Refreshes without locking reads. Requires a UNIQUE index on the materialized view.', pgOnly: true, example: "-- Requires a UNIQUE index!\nCREATE UNIQUE INDEX ON monthly_stats (month);\nREFRESH MATERIALIZED VIEW CONCURRENTLY monthly_stats;" },
    { name: 'DROP VIEW', category: 'Views & Materialized Views', insertText: 'DROP VIEW IF EXISTS ${1:view_name};', syntax: "DROP VIEW [IF EXISTS] view_name [CASCADE]", doc: 'Removes a view. Use CASCADE to also drop dependent objects.', example: "DROP VIEW IF EXISTS active_users CASCADE;" },
    { name: 'DROP MATERIALIZED VIEW', category: 'Views & Materialized Views', insertText: 'DROP MATERIALIZED VIEW IF EXISTS ${1:view_name};', syntax: "DROP MATERIALIZED VIEW [IF EXISTS] view_name [CASCADE]", doc: 'Removes a materialized view and its stored data.', pgOnly: true, example: "DROP MATERIALIZED VIEW IF EXISTS monthly_stats;" },

    // ── Utility ──
    { name: 'GENERATE_SERIES', category: 'Utility', insertText: 'GENERATE_SERIES(${1:start}, ${2:stop}, ${3:step})', syntax: "GENERATE_SERIES(start, stop, step)", doc: 'Generates a series of values.' },
    { name: 'UNNEST', category: 'Utility', insertText: 'UNNEST(${1:array})', syntax: "UNNEST(array)", doc: 'Expands array elements into individual rows.' },
    { name: 'EXISTS', category: 'Utility', insertText: 'EXISTS (${1:subquery})', syntax: "EXISTS(subquery)", doc: 'Returns TRUE if the subquery returns any rows.' },
];

export function getSqlFunctions(driver: string): SqlFunctionDef[] {
    const isDuck = driver === 'duckdb';
    return SQL_FUNCTIONS.filter(fn => {
        if (fn.duckdbOnly && !isDuck) return false;
        if (fn.pgOnly && isDuck) return false;
        return true;
    });
}
