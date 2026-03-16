\c locate_my_bus;

CREATE TABLE IF NOT EXISTS public.agency (
    id                          UUID            NOT NULL,
    name                        VARCHAR(45),
    url                         VARCHAR(100),
    timezone                    VARCHAR(75),
    lang                        VARCHAR(45),
    phone                       VARCHAR(45),
    fare_url                    VARCHAR(100),
    rt_feed_url                 VARCHAR(1000)    NOT NULL,
    static_feed_url             VARCHAR(1000)    NOT NULL,
    PRIMARY KEY (id)
);

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

ALTER TABLE public.agency 
ADD COLUMN api_key_in_header VARCHAR(300),
ALTER COLUMN url TYPE VARCHAR(1000),
ALTER COLUMN fare_url TYPE VARCHAR(1000);

ALTER TABLE public.route
ALTER COLUMN short_name TYPE VARCHAR(100),
ALTER COLUMN long_name TYPE VARCHAR(200);

ALTER TABLE public.live_vehicle_position
ADD COLUMN head_bearing DOUBLE PRECISION;

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
    shape_id                    VARCHAR(45)         NOT NULL,
    shape_pt_lat                DOUBLE PRECISION    NOT NULL,
    shape_pt_lon                DOUBLE PRECISION    NOT NULL,
    shape_pt_sequence           VARCHAR(45)         NOT NULL,
    shape_dist_traveled         DOUBLE PRECISION,
    PRIMARY KEY (agency_id, shape_id, shape_pt_sequence),
    CONSTRAINT fk_shape FOREIGN KEY (agency_id, shape_id) REFERENCES public.shape (agency_id, id) ON DELETE CASCADE
);

-- trip now FKs cleanly to the shape header
CREATE TABLE IF NOT EXISTS public.trip (
    id                          VARCHAR(45)     NOT NULL,
    agency_id                   UUID            NOT NULL,
    route_id                    VARCHAR(45)     NOT NULL,
    shape_id                    VARCHAR(45)     NOT NULL,
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency    FOREIGN KEY (agency_id)           REFERENCES public.agency (id)                 ON DELETE CASCADE,
    CONSTRAINT fk_route     FOREIGN KEY (agency_id, route_id) REFERENCES public.route (agency_id, id)       ON DELETE CASCADE,
    CONSTRAINT fk_shape     FOREIGN KEY (agency_id, shape_id) REFERENCES public.shape (agency_id, id)       ON DELETE CASCADE
);