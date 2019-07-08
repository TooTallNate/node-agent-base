'use strict';
const urlPackage = require('url');
const https = require('https');

// Support for both
// fn(options[, callback])
// fn(url[, options][, callback])
function normalizeParameters(fn) {
  return function(_url, _options, cb) {
    var url = _url;
    var options = _options;
    // If fn(options[, callback]), let's rearrange the parameters
    if (typeof _url !== 'string' && !cb) {
      cb = _options;
      options = _url;
      url = undefined;
    }
    // If options is a string, try to parse it
    var options;
    if (typeof options === 'string') {
      options = urlPackage.parse(options);
    }
    // If either the user passed an empty url, or we cleaned it after reorganizing the parameters,
    // let's try to reconstruct the url from the options.
    // Node's url.format supports both the legacy API and the WHATWG API.
    // After this, url should be a string.
    if (!url && options) {
      url = urlPackage.format(options);
    }
    // At this point we should have valid, non empty values for url and options.
    // Let's merge them.
    var merged_options = urlPackage.parse(url);
    if (options) {
      if (options && Object.getOwnPropertySymbols && Object.getOwnPropertySymbols(options)[0]) {
        var urlContext = options[Object.getOwnPropertySymbols(options)[0]];
        for (var key of Object.keys(urlContext)) {
          merged_options[key] = urlContext[key];
        }
      } else {
        for (var key of Object.keys(options)) {
          merged_options[key] = options[key];
        }
      }
    }
    return fn(url, merged_options, cb);
  }
}

/**
 * This currently needs to be applied to all Node.js versions
 * in order to determine if the `req` is an HTTP or HTTPS request.
 *
 * There is currently no PR attempting to move this property upstream.
 */
const patchMarker = "__agent_base_https_request_patched__";
if (!https.request[patchMarker]) {
  https.request = (function(request) {
    // Supports for both
    // https.request(options[, callback])
    // https.request(url[, options][, callback])
    return normalizeParameters(function(url, options, cb) {
      if (null == options.port) {
        options.port = 443;
      }
      options.secureEndpoint = true;
      return request.call(https, options, cb);
    });
  })(https.request);
  https.request[patchMarker] = true;
}

/**
 * This is needed for Node.js >= 9.0.0 to make sure `https.get()` uses the
 * patched `https.request()`.
 *
 * Ref: https://github.com/nodejs/node/commit/5118f31
 *
 * Support for both
 * https.get(options[, callback])
 * https.get(url[, options][, callback])
 */
https.get = normalizeParameters(function (url, options, cb) {
  const req = https.request(options, cb);
  req.end();
  return req;
});
