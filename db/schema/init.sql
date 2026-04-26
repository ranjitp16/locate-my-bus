\c locate_my_bus;

CREATE TABLE IF NOT EXISTS public.agency (
    id                          UUID            NOT NULL,
    name                        VARCHAR(45),
    url                         VARCHAR(1000),
    timezone                    VARCHAR(75),
    lang                        VARCHAR(45),
    phone                       VARCHAR(45),
    fare_url                    VARCHAR(1000),
    rt_feed_url                 VARCHAR(1000)    NOT NULL,
    static_feed_url             VARCHAR(1000)    NOT NULL,
    PRIMARY KEY (id)
);

ALTER TABLE public.agency 
ADD COLUMN api_key_in_header VARCHAR(300),
ALTER COLUMN url TYPE VARCHAR(1000),
ALTER COLUMN fare_url TYPE VARCHAR(1000);

CREATE TABLE IF NOT EXISTS public.route (
    id                    VARCHAR(45)     NOT NULL,
    agency_id             UUID            NOT NULL,
    short_name            VARCHAR(45),
    long_name             VARCHAR(100),
    type                VARCHAR(45),
    color                 VARCHAR(45),
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

ALTER TABLE public.route
ALTER COLUMN short_name TYPE VARCHAR(500),
ALTER COLUMN long_name TYPE VARCHAR(1000);

-- Represents the shape as a whole (one row per shape)
CREATE TABLE IF NOT EXISTS public.shape (
    id                          VARCHAR(45)     NOT NULL,
    agency_id                   UUID            NOT NULL,
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

-- Represents the individual GPS points of a shape
CREATE TABLE IF NOT EXISTS public.shape_point (
    agency_id                   UUID                NOT NULL,
    id                          VARCHAR(45)         NOT NULL,
    pt_lat                      DOUBLE PRECISION    NOT NULL,
    pt_lon                      DOUBLE PRECISION    NOT NULL,
    pt_sequence                 VARCHAR(45)         NOT NULL,
    dist_traveled               DOUBLE PRECISION,
    PRIMARY KEY (agency_id, id, pt_sequence),
    CONSTRAINT fk_shape FOREIGN KEY (agency_id, id) REFERENCES public.shape (agency_id, id) ON DELETE CASCADE
);

-- trip now FKs cleanly to the shape header
CREATE TABLE IF NOT EXISTS public.trip (
    id                          VARCHAR(45)     NOT NULL,
    service_id                  VARCHAR(45)     NOT NULL,
    agency_id                   UUID            NOT NULL,
    route_id                    VARCHAR(45)     NOT NULL,
    trip_headsign               VARCHAR(1000),
    direction_id                VARCHAR(10),
    shape_id                    VARCHAR(45),
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency    FOREIGN KEY (agency_id)           REFERENCES public.agency (id)                 ON DELETE CASCADE,
    CONSTRAINT fk_route     FOREIGN KEY (agency_id, route_id) REFERENCES public.route (agency_id, id)       ON DELETE CASCADE,
    CONSTRAINT fk_shape     FOREIGN KEY (agency_id, shape_id) REFERENCES public.shape (agency_id, id)       ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.live_vehicle_position (
    id                          UUID            NOT NULL,
    agency_id                   UUID            NOT NULL,    
    route_id                    VARCHAR(45)     NOT NULL,
    route_short_name            VARCHAR(45),
    lon                         DOUBLE PRECISION,
    lat                         DOUBLE PRECISION,
    vehicle_id                  VARCHAR(45),
    timestamp                   TIMESTAMPTZ,
    vehicle_distance_traveled   DOUBLE PRECISION,
    speed                       DOUBLE PRECISION,
    PRIMARY KEY (id),
    CONSTRAINT fk_agency    FOREIGN KEY (agency_id)            REFERENCES public.agency (id)              ON DELETE CASCADE,
    CONSTRAINT fk_route     FOREIGN KEY (agency_id, route_id)  REFERENCES public.route (agency_id, id)    ON DELETE CASCADE
);

ALTER TABLE public.live_vehicle_position
ADD COLUMN IF NOT EXISTS head_bearing DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS trip_id VARCHAR(45) NOT NULL,
ADD CONSTRAINT fk_trip FOREIGN KEY (agency_id, trip_id) REFERENCES public.trip (agency_id, id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.poll_iteration (
    id                BIGINT          PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    started_at        TIMESTAMPTZ     NOT NULL,
    agency_count      INT             NOT NULL,
    total_executions  INT             NOT NULL
);

CREATE TABLE IF NOT EXISTS public.feed_execution (
    id                  BIGINT          NOT NULL,
    poll_iteration_id   BIGINT          NOT NULL REFERENCES public.poll_iteration (id) ON DELETE CASCADE,
    agency_id           UUID            NOT NULL REFERENCES public.agency (id) ON DELETE CASCADE,
    is_cache_hit        BOOLEAN         NOT NULL DEFAULT FALSE,
    program_start_us    BIGINT          NOT NULL,
    program_end_us      BIGINT          NOT NULL,
    execution_time_us   INT             GENERATED ALWAYS AS (CAST(program_end_us - program_start_us AS INT)) STORED,
    download_time_us    INT,
    status              VARCHAR(20)     NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'timeout')),
    error_message       TEXT,
    CONSTRAINT pk_feed_execution
        PRIMARY KEY (poll_iteration_id, id),
    CONSTRAINT chk_end_after_start
        CHECK (program_end_us >= program_start_us),
    CONSTRAINT chk_download_null_on_cache
        CHECK (is_cache_hit = FALSE OR download_time_us IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_fe_agency         ON public.feed_execution (agency_id);
CREATE INDEX IF NOT EXISTS idx_fe_cache_hit      ON public.feed_execution (is_cache_hit);
CREATE INDEX IF NOT EXISTS idx_fe_execution_time ON public.feed_execution (execution_time_us DESC);

-- Fix timing columns: INT can overflow for long-running executions (> ~2147 s).
-- Widen download_time_us to BIGINT; regenerate execution_time_us as BIGINT (generated
-- columns cannot be altered in-place — must drop and re-add).
ALTER TABLE public.feed_execution ALTER COLUMN download_time_us TYPE BIGINT;
DROP INDEX IF EXISTS idx_fe_execution_time;
ALTER TABLE public.feed_execution DROP COLUMN IF EXISTS execution_time_us;
ALTER TABLE public.feed_execution ADD COLUMN execution_time_us BIGINT GENERATED ALWAYS AS (program_end_us - program_start_us) STORED;
CREATE INDEX IF NOT EXISTS idx_fe_execution_time ON public.feed_execution (execution_time_us DESC);

CREATE TABLE IF NOT EXISTS public.stop (
    id                  VARCHAR(45)         NOT NULL,
    agency_id           UUID                NOT NULL,
    code                VARCHAR(45),
    name                VARCHAR(500),
    description         VARCHAR(1000),
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,
    location_type       VARCHAR(10),
    wheelchair_boarding VARCHAR(10),
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.stop_time (
    agency_id       UUID            NOT NULL,
    trip_id         VARCHAR(45)     NOT NULL,
    stop_id         VARCHAR(45)     NOT NULL,
    arrival_time    VARCHAR(10),
    departure_time  VARCHAR(10),
    stop_sequence   VARCHAR(10)     NOT NULL,
    pickup_type     VARCHAR(10),
    drop_off_type   VARCHAR(10),
    timepoint       VARCHAR(10),
    PRIMARY KEY (agency_id, trip_id, stop_id, stop_sequence),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE,
    CONSTRAINT fk_trip   FOREIGN KEY (agency_id, trip_id) REFERENCES public.trip (agency_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_stop   FOREIGN KEY (agency_id, stop_id) REFERENCES public.stop (agency_id, id) ON DELETE CASCADE
);

-- GTFS calendar: which days each service_id operates
CREATE TABLE IF NOT EXISTS public.calendar (
    agency_id       UUID            NOT NULL,
    service_id      VARCHAR(45)     NOT NULL,
    monday          VARCHAR(1)      NOT NULL DEFAULT '0',
    tuesday         VARCHAR(1)      NOT NULL DEFAULT '0',
    wednesday       VARCHAR(1)      NOT NULL DEFAULT '0',
    thursday        VARCHAR(1)      NOT NULL DEFAULT '0',
    friday          VARCHAR(1)      NOT NULL DEFAULT '0',
    saturday        VARCHAR(1)      NOT NULL DEFAULT '0',
    sunday          VARCHAR(1)      NOT NULL DEFAULT '0',
    start_date      VARCHAR(10),
    end_date        VARCHAR(10),
    PRIMARY KEY (agency_id, service_id),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

-- GTFS calendar_dates: exceptions (added/removed service on specific dates)
CREATE TABLE IF NOT EXISTS public.calendar_date (
    agency_id       UUID            NOT NULL,
    service_id      VARCHAR(45)     NOT NULL,
    date            VARCHAR(10)     NOT NULL,
    exception_type  VARCHAR(2)      NOT NULL,
    PRIMARY KEY (agency_id, service_id, date),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

-- ── Indexes for trip planner performance ──
CREATE INDEX IF NOT EXISTS idx_stop_agency_lat_lon    ON public.stop (agency_id, lat, lon);
CREATE INDEX IF NOT EXISTS idx_stop_time_stop         ON public.stop_time (agency_id, stop_id);
CREATE INDEX IF NOT EXISTS idx_trip_route             ON public.trip (agency_id, route_id);
CREATE INDEX IF NOT EXISTS idx_trip_service            ON public.trip (agency_id, service_id);
CREATE INDEX IF NOT EXISTS idx_live_vp_route          ON public.live_vehicle_position (agency_id, route_id);
CREATE INDEX IF NOT EXISTS idx_live_vp_trip           ON public.live_vehicle_position (agency_id, route_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_shape_point_shape      ON public.shape_point (agency_id, id);
