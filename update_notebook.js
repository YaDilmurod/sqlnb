const fs = require('fs');

const data = JSON.parse(fs.readFileSync('../simulation_v2.sqlnb', 'utf8'));

// 1. Restore wait_time in queues block
const queueSQL = `create or replace view public.queues_view as
WITH
  queues AS (
    SELECT
      COALESCE(b_parent.source_booking_id, b_parent.id) AS route_id,
      q.id AS step_id,
      q.user_id,
      'LIVE_QUEUE' AS flow_type,
      q.service_codes::TEXT AS service_code,
      a.doctor_type,
      a.login AS doctor_login,
      (q.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent' AS planned_datetime,
      (q.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent' AS start_datetime,
      CASE
        WHEN q.status = 'FINISHED' THEN q.updated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'
        ELSE NULL
      END AS end_datetime,
      q.status::TEXT AS current_status,
      NULL AS session_action,
      NULLIF(
        CASE
          WHEN q.started_at IS NOT NULL THEN GREATEST(
            0,
            EXTRACT(
              EPOCH
              FROM
                (
                  (q.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent' - (
                    (q.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'
                  )
                )
            ) / 60
          )
          WHEN q.started_at IS NULL
          AND q.status = 'WAITING' THEN GREATEST(
            0,
            EXTRACT(
              EPOCH
              FROM
                (
                  (NOW() AT TIME ZONE 'Asia/Tashkent') - (
                    (q.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'
                  )
                )
            ) / 60
          )
          WHEN q.started_at IS NULL
          AND q.status IN ('ACTIVE', 'FINISHED') THEN GREATEST(
            0,
            EXTRACT(
              EPOCH
              FROM
                (
                  (
                    (q.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'
                  ) - (
                    (q.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'
                  )
                )
            ) / 60
          )
          ELSE 0
        END,
        0
      ) AS wait_time
    FROM
      queues q
      LEFT JOIN service_categories AS sc ON q.service_category_id = sc.id
      LEFT JOIN sessions AS s_parent ON q.source_session_id = s_parent.id
      LEFT JOIN bookings AS b_parent ON s_parent.booking_id = b_parent.id
      LEFT JOIN admins AS a ON q.admin_id = a.id
  )
SELECT
  *,
  EXTRACT(
    EPOCH
    FROM
      (end_datetime - start_datetime)
  ) / 60 AS service_duration,
  TO_CHAR(DATE_TRUNC('hour', start_datetime), 'HH24:MI') AS start_hour_text,
  TO_CHAR(DATE_TRUNC('hour', planned_datetime), 'HH24:MI') AS planned_hour_text,
  0 AS is_follow_up
FROM
  queues`;

// 3. Remove wait_time_unified from unified_flow
for (let cell of data.cells) {
  if (cell.name === 'queue') {
    cell.content = queueSQL;
  }
  if (cell.name === 'unified_flow') {
    // Remove the wait_time_unified column
    cell.content = cell.content.replace(
      /,\n  NULLIF\(\n    GREATEST\(\n      0,\n      EXTRACT\(\n        EPOCH\n        FROM\n          \(start_datetime - planned_datetime\)\n      \) \/ 60\n    \),\n    0\n  \) AS wait_time_unified/,
      ''
    );
  }
}

fs.writeFileSync('../simulation_v2.sqlnb', JSON.stringify(data, null, 2) + '\n');
console.log('1. Restored wait_time in queues');
console.log('3. Removed wait_time_unified from unified_flow');
