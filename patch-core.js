'use strict';
const url = require('url');
const https = require('https');

/**
 * This currently needs to be applied to all Node.js versions
 * in order to determine if the `req` is an HTTP or HTTPS request.
 *
 * There is currently no PR attempting to move this property upstream.
 */
const patchMarker = "__agent_base_https_request_patched__";
if (!https.request[patchMarker]) {
  https.request = (function(request) {
    return function(_url, _options, cb) {
      // Support for both
      // https.request(options[, callback])
      // https.request(url[, options][, callback])
      if (typeof _url !== 'string' && !cb) {
        cb = _options;
        _options = _url;
        _url = undefined;
      }
      if (!_url && _options) {
        _url = url.format(_options);
      }
      let options;
      if (typeof _options === 'string') {
        options = url.parse(_options);
      } else {
        options = url.parse(_url);
        if (_options) {
          if (_options && Object.getOwnPropertySymbols(_options)[0]) {
            let urlContext = _options[Object.getOwnPropertySymbols(_options)[0]];
            for (let key of Object.keys(urlContext)) {
              options[key] = urlContext[key];
            }
          } else {
            for (let key of Object.keys(_options)) {
              options[key] = _options[key];
            }
          }
        }
      }
      if (null == options.port) {
        options.port = 443;
      }
      options.secureEndpoint = true;
      return request.call(https, options, cb);
    };
  })(https.request);
  https.request[patchMarker] = true;
}

/**
 * This is needed for Node.js >= 9.0.0 to make sure `https.get()` uses the
 * patched `https.request()`.
 *
 * Ref: https://github.com/nodejs/node/commit/5118f31
 */
https.get = function (_url, _options, cb) {
  // Support for both
  // https.get(options[, callback])
  // https.get(url[, options][, callback])
  if (typeof _url !== 'string' && !cb) {
    cb = _options;
    _options = _url;
    _url = undefined;
  }
  if (!_url && _options) {
    _url = url.format(_options);
  }
  let options;
  if (typeof _options === 'string') {
    options = url.parse(_options);
  } else {
    options = url.parse(_url);
    if (_options) {
      if (_options && Object.getOwnPropertySymbols(_options)[0]) {
        let urlContext = _options[Object.getOwnPropertySymbols(_options)[0]];
        for (let key of Object.keys(urlContext)) {
          options[key] = urlContext[key];
        }
      } else {
        for (let key of Object.keys(_options)) {
          options[key] = _options[key];
        }
      }
    }
  }

  const req = https.request(options, cb);
  req.end();
  return req;
};
