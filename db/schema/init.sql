\c locate_my_bus;

CREATE TABLE IF NOT EXISTS public.vehicle_position (
    id                        UUID            NOT NULL,
    route_id                  VARCHAR(45),
    route_short_name          VARCHAR(45),
    lon                       DOUBLE PRECISION,
    lat                       DOUBLE PRECISION,
    vehicle_id                VARCHAR(45),
    timestamp                 TIMESTAMPTZ,
    vehicle_distance_traveled DOUBLE PRECISION,
    speed                     DOUBLE PRECISION,
    PRIMARY KEY (id)
);