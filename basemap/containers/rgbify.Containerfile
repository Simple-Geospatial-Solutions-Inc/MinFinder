# basemap/containers/rgbify.Containerfile — rasterio + rio-rgbify for terrain-RGB encoding.
# No official rio-rgbify image exists, so the pipeline builds this tiny pinned one
# (03-terrain-rgb.sh does it automatically):
#   podman build -f containers/rgbify.Containerfile -t minfinder-rgbify:0.4.0 containers
#
# Pins — how to check for newer versions:
#   python base image: https://hub.docker.com/_/python (3.11.<patch>-slim-bookworm tags)
#   rio-rgbify:        https://pypi.org/project/rio-rgbify/  (0.4.0 is the latest release
#                      as of 2026-08; the project is dormant, so expect no updates)
#   rasterio:          https://pypi.org/project/rasterio/    (1.3.11 is the newest 1.3.x;
#                      rio-rgbify declares rasterio~=1.0, but 1.3.x is the safest match)
FROM python:3.11.9-slim-bookworm

# rio-rgbify was last released in 2018 and predates numpy 2.0, so hold numpy at
# the final 1.x release. rasterio 1.3.x manylinux wheels bundle their own GDAL,
# so no apt packages are needed at all.
# rio-mucho and mercantile are rio-rgbify deps it leaves unpinned; both projects
# are dormant, so pin their (final) releases for reproducible builds.
# Import-chain compatibility verified against the published sources: rasterio
# 1.3.11 still ships rasterio._io.virtual_file_to_buffer (mbtiler.py needs it),
# and riomucho 1.0.0's rasterio.transform.guard_transform import is still
# present in 1.3.x.
# UNVERIFIED: rio-rgbify 0.4.0 has not been *executed* against this exact
# python/numpy/rasterio trio here — on first run, `rio rgbify --help` inside the
# image should print usage; if it raises an import/deprecation error, step
# rasterio down to 1.2.10 and python to 3.9-slim.
RUN pip install --no-cache-dir \
      numpy==1.26.4 \
      rasterio==1.3.11 \
      rio-mucho==1.0.0 \
      mercantile==1.2.1 \
      rio-rgbify==0.4.0

WORKDIR /work

# No ENTRYPOINT on purpose: callers invoke the CLI explicitly, e.g.
#   podman run --rm localhost/minfinder-rgbify:0.4.0 rio rgbify --help
