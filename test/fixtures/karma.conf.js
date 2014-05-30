module.exports = function(config) {
    config.set({
      basePath : '../../',

      // Files to browserify
      browserify: {
        files: [
          'test/unit/**/*.js',
        ]
      },

      files : [
        // 'test/artifacts/**/*.js',
        'test/lib/**/*.js',
        // 'test/unit/**/*.js',
        // 'js/sound/SoundDecoder.js',
        // 'js/sound/**/*.js',
        // 'js/util/**/*.js',
        // 'js/**/*.js',
        'node_modules/jasmine-jquery/lib/jasmine-jquery.js',
        'node_modules/underscore/underscore.js'
      ],

      exclude : [
      ],

      preprocessors: {
        '*.html': 'html2js',
        '/**/*.browserify': 'browserify'
      },

      autoWatch : true,

      frameworks: [
        'jasmine',
        'browserify'
      ],

      browsers : ['Chrome'],

      plugins : [
        'karma-jasmine',
        'karma-browserifast',
        'jasmine-jquery',
        'karma-html2js-preprocessor',
        'karma-chrome-launcher',
        'karma-firefox-launcher'
     ]
  });
}
