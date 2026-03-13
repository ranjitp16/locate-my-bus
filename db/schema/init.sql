\c locate_my_bus;

CREATE TABLE IF NOT EXISTS public.agency (
    id                          UUID            NOT NULL,
    name                        VARCHAR(45),
    url                         VARCHAR(100),
    timezone                    VARCHAR(75),
    language                    VARCHAR(45),
    phone                       VARCHAR(45),
    fare_url                    VARCHAR(100),
    rt_feed_url                 VARCHAR(100)    NOT NULL,
    static_feed_url             VARCHAR(100)    NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.route (
    id                          VARCHAR(45)     NOT NULL,
    agency_id                   UUID            NOT NULL,
    route_short_name            VARCHAR(45),
    route_long_name             VARCHAR(100),
    route_type                  VARCHAR(45),
    route_color                 VARCHAR(45),
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
    CONSTRAINT fk_agency    FOREIGN KEY (agency_id) REFERENCES public.agency (id)   ON DELETE CASCADE,
    CONSTRAINT fk_route     FOREIGN KEY (route_id)  REFERENCES public.route (id)    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.shape(
    id                          VARCHAR(45)         NOT NULL,
    agency_id                   UUID                NOT NULL,
    shape_pt_lat                DOUBLE PRECISION    NOT NULL,                
    shape_pt_lon                DOUBLE PRECISION    NOT NULL,
    shape_pt_sequence           VARCHAR(45)         NOT NULL,
    shape_dist_traveled         DOUBLE PRECISION,
    PRIMARY KEY(agency_id, id, shape_pt_sequence),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.trip (
    id                          VARCHAR(45)     NOT NULL,
    agency_id                   UUID            NOT NULL,
    route_id                    VARCHAR(45)     NOT NULL,
    shape_id                    VARCHAR(45)     NOT NULL,
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency    FOREIGN KEY (agency_id)     REFERENCES public.agency (id)   ON DELETE CASCADE,
    CONSTRAINT fk_shape     FOREIGN KEY (shape_id)      REFERENCES public.shape (id)    ON DELETE CASCADE
);