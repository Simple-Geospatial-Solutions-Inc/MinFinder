document.addEventListener("DOMContentLoaded", function(event) {

    if (window.DeviceOrientationEvent) {
        document.getElementById("notice").innerHTML = "Using DeviceOrientationEvent API.";
        window.addEventListener('deviceorientation', function(eventData) {
            // gamma: Tilting the device from left to right. Tilting the device to the right will result in a positive value.
            var tiltLR = eventData.gamma;
            // beta: Tilting the device from the front to the back. Tilting the device to the front will result in a positive value.
            var tiltFB = eventData.beta;
            // alpha: The direction the compass of the device aims to in degrees.
            var dir = eventData.alpha;
            // Call the function to use the data on the page.
            document.getElementById("direction").innerHTML = deg_to_dms((360 - dir), 0, 0, 0);
            // Rotate the disc of the compass.
            var compassDisc = document.getElementById("compassDiscImg");
            compassDisc.style.webkitTransform = "rotate(" + dir + "deg)";
            compassDisc.style.MozTransform = "rotate(" + dir + "deg)";
            compassDisc.style.transform = "rotate(" + dir + "deg)";
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(showPosition);
            } else {
                document.getElementById("latitude").innerHTML = "GeoLocation Not Supported";
                document.getElementById("longitude").innerHTML = "GeoLocation Not Supported";
            }
        }, false);
    } else {
        document.getElementById("notice").innerHTML = "Orientation not supported by this device."
    };

    function showPosition(position) {
        var cur_lat = position.coords.latitude;
        var cur_long = position.coords.longitude;
        var dest_lat = 49.87963;
        var dest_long = -119.42712;
        var dist_calc = distance(cur_lat, cur_long, dest_lat, dest_long);
        var dist = parseInt(dist_calc[0]);
        var brg = 360 - parseFloat(dist_calc[1]);
        document.getElementById("latitude").innerHTML = deg_to_dms(cur_lat, 4, 1, 0);
        document.getElementById("longitude").innerHTML = deg_to_dms(cur_long, 4, 0, 1);
        document.getElementById("distance").innerHTML = dist + "m";
        document.getElementById("bearing").innerHTML = deg_to_dms((brg), 0, 0, 0);
        window.addEventListener('deviceorientation', function(eventData2) {
            // alpha: The direction the compass of the device aims to in degrees.
            var dir = eventData2.alpha;
            var rot = dir + brg;
            var compassArrow = document.getElementById("compassArrowImg");
            compassArrow.style.webkitTransform = "rotate(" + rot + "deg)";
            compassArrow.style.MozTransform = "rotate(" + rot + "deg)";
            compassArrow.style.transform = "rotate(" + rot + "deg)";
        }, false);

    }

    function deg_to_dms(deg, places, islat, islong) {
        var d = Math.floor(Math.abs(deg));
        var minfloat = (Math.abs(deg) - d) * 60;
        var m = Math.floor(minfloat);
        var secfloat = (minfloat - m) * 60;
        if (secfloat.toFixed(places) == 60) {
            m++;
            secfloat = 0;
        }
        if (m == 60) {
            d++;
            m = 0;
        }
        if (places == 0) {
            var padnum = places + 2;
        } else {
            var padnum = places + 3;
        }
        if (deg < 0) {
            if (islat == 1) {
                var prefix = "S";
            } else if (islong == 1) {
                var prefix = "W";
            } else {
                var prefix = "-";
            }
        } else if (deg > 0) {
            if (islat == 1) {
                var prefix = "N";
            } else if (islong == 1) {
                var prefix = "E";
            } else {
                var prefix = "";
            }
        } else {
            var prefix = "";
        }
        return (prefix + d + "°" + lpad(m, 2) + "'" + lpad(secfloat.toFixed(places), padnum) + "\"");
    }

    function lpad(num, size) {
        var s = num + "";
        while (s.length < size) s = "0" + s;
        return s;
    }

    function distance(lat1, lon1, lat2, lon2) {
        var R = 6372000; // mean earth radius
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var lat1 = (lat1) * Math.PI / 180;
        var lat2 = (lat2) * Math.PI / 180;

        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        var d = R * c;

        var y = Math.sin(dLon) * Math.cos(lat2);
        var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        var brng = Math.atan2(y, x) * 180 / Math.PI;
        brng = 360 - ((brng + 360) % 360);

        return [d, brng];
    }

});