var urlParams = new URLSearchParams(window.location.search);
var marker = urlParams.get("mrk");
var dest_lat = parseFloat(urlParams.get("lat"));
var dest_long = parseFloat(urlParams.get("lon"));
var geoOptions = {
        timeout: 27000,
        enableHighAccuracy: true,
        maximumAge: 30000
    };
var initialOffset = null;
var firstdir = -1;
var dirtype;
var userAgent = window.navigator.userAgent;
    
function lpad(num, size) {
    var s = num.toString();
    while (s.length < size) {
        s = "0" + s;
    }
    return s;
}

function deg_to_dms(deg, places, islat, islong) {
    var d = Math.floor(Math.abs(deg)),
        minfloat = (Math.abs(deg) - d) * 60,
        m = Math.floor(minfloat),
        secfloat = (minfloat - m) * 60,
        padnum,
        prefix;
    if (secfloat.toFixed(places) == 60) {
        m += 1;
        secfloat = 0;
    }
    if (m == 60) {
        d += 1;
        m = 0;
    }
    if (places == 0) {
        padnum = places + 2;
    } else {
        padnum = places + 3;
    }
    if (deg < 0) {
        if (islat == 1) {
            prefix = "S";
        } else if (islong == 1) {
            prefix = "W";
        } else {
            prefix = "-";
        }
    } else if (deg > 0) {
        if (islat == 1) {
            prefix = "N";
        } else if (islong == 1) {
            prefix = "E";
        } else {
            prefix = "";
        }
    } else {
        prefix = "";
    }
    return (prefix + d + "°" + lpad(m, 2) + "'" + lpad(secfloat.toFixed(places), padnum) + "\"");
}

function distance(lat1, lon1) {
    var R = 6372000, // mean earth radius
        dLat_r = (dest_lat - lat1) * Math.PI / 180,
        dLon_r = (dest_long - lon1) * Math.PI / 180,
        lat1_r = lat1 * Math.PI / 180,
        lat2_r = dest_lat * Math.PI / 180,
        a = Math.sin(dLat_r / 2) * Math.sin(dLat_r / 2) + Math.sin(dLon_r / 2) * Math.sin(dLon_r / 2) * Math.cos(lat1_r) * Math.cos(lat2_r),
        c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
        d = R * c,
        y = Math.sin(dLon_r) * Math.cos(lat2_r),
        x = Math.cos(lat1_r) * Math.sin(lat2_r) - Math.sin(lat1_r) * Math.cos(lat2_r) * Math.cos(dLon_r),
        brng = Math.atan2(y, x) * 180 / Math.PI;
    brng = 360 - ((brng + 360) % 360);
    return [d, brng];
}

function showPosition(position) {
    var cur_lat = position.coords.latitude,
        cur_long = position.coords.longitude,
        acc = Math.round(position.coords.accuracy),
        dist_calc = distance(cur_lat, cur_long),
        dist = Math.round(dist_calc[0]),
        brg = 360 - dist_calc[1],
        dir,
        rot,
        compassArrow = document.getElementById("compassArrowImg"),
        compassDisc = document.getElementById("compassDiscImg");
//    const isIOS = !(
//        navigator.userAgent.match(/(iPod|iPhone|iPad)/) &&
//        navigator.userAgent.match(/AppleWebKit/)
//    );
//    if (isIOS) {
//    DeviceOrientationEvent.requestPermission()
//      .then((response) => {
//        if (response === "granted") {
//          
//        } else {
//          alert("has to be allowed!");
//        }
//      })
//      .catch(() => alert("not supported"));
//    }
    document.getElementById("marker").innerHTML = marker;
    document.getElementById("distance").innerHTML = dist + "m";
    document.getElementById("bearing").innerHTML = brg.toFixed(0).toString() + "°";
    document.getElementById("latitude").innerHTML = deg_to_dms(cur_lat, 2, 1, 0);
    document.getElementById("longitude").innerHTML = deg_to_dms(cur_long, 2, 0, 1);
    document.getElementById("accuracy").innerHTML = acc + "m";
    if (screen.width > 800 && screen.height > 800) {
        document.getElementById("setnorth").innerHTML = "";
    }
    if (window.DeviceOrientationEvent) {
        window.addEventListener("deviceorientation", function(event) {
             if (event.webkitCompassHeading) {
                // for Apple, not convinced this is reliable
                dir = event.webkitCompassHeading;
                firstdir = 1;
                dirtype = 5;
            } else {
                dir = event.alpha;
                if (userAgent.match(/iP(ad|hone)/i)) {
                    firstdir = 1;
                    dirtype = 5;
                    document.getElementById("setnorth").innerHTML = "";
                }
            }
            if (firstdir == -1) {
                firstdir = 1;
                switch (true) {
                    case ((dir >= 355) || (dir <= 0)):
                        dirtype = 1;
                        break;
                    case ((dir >= 85) && (dir <= 95)):
                        dirtype = 2;
                        break;
                    case ((dir >= 175) && (dir <= 185)):
                        dirtype = 3;
                        break;
                    case ((dir >= 265) && (dir <= 275)):
                        dirtype = 4;
                        break;
                    default:
                        dirtype = 0;
                }
            }
            switch (dirtype) {
                case 0:
                    dir = 360 - dir;
                    break;
                case 1:
                    dir = 360 - dir;
                    break;
                case 2:
                    dir = (360 - dir) + 90;
                    break;
                case 3:
                    dir = (360 - dir) + 180;
                    break;
                case 4:
                    dir = (360 - dir) - 90;
                    break;
                case 5:
                    break;
            }
            // if (window.innerHeight < window.innerWidth) {
            //     dir += 90;
            // }
            if (dir < 0) {
                dir += 360;
            }
            if (dir >= 360) {
                dir -= 360;
            }
            rot = brg - dir;
            compassArrow.style.webkitTransform = "rotate(" + rot + "deg)";
            compassDisc.style.webkitTransform = "rotate(-" + dir + "deg)";
            compassArrow.style.MozTransform = "rotate(" + rot + "deg)";
            compassDisc.style.MozTransform = "rotate(-" + dir + "deg)";
            compassArrow.style.transform = "rotate(" + rot + "deg)";
            compassDisc.style.transform = "rotate(-" + dir + "deg)";
            document.getElementById("direction").innerHTML = dir.toFixed(0).toString() + "°";
        }, false);
    } else {
        document.getElementById("notice").innerHTML = "Orientation not supported by this device.";
        document.getElementById("setnorth").innerHTML = "";
    }
}

function geoError(msg) {
    document.getElementById("distance").innerHTML = msg;
    document.getElementById("bearing").innerHTML = msg;
    document.getElementById("latitude").innerHTML = msg;
    document.getElementById("longitude").innerHTML = msg;
    document.getElementById("accuracy").innerHTML = msg;
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(showPosition, geoError("Not available"), geoOptions);
} else {
    geoError("Not supported");
}