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
        'node_modules/jasmine-jquery/lib/jasmine-jquery.js',
        'node_modules/underscore/underscore.js',
        'test/lib/**/*.js',
        'test/unit/**/*.js'
      ],

      exclude : [],

      preprocessors: {
        '*.html': 'html2js',
        'js/**/*.js': 'commonjs',
        'test/unit/**/*.js': 'commonjs'
      },

      // commonjsPreprocessor: {
      //     modulesRoot: 'test/unit'
      // },
      autoWatch : true,

      frameworks: [
        'commonjs',
        'jasmine'
      ],

      browsers : ['Chrome'],

      // This lot can be removed - http://karma-runner.github.io/0.12/config/plugins.html
      plugins : [
        'karma-jasmine',
        'karma-commonjs',
        'karma-html2js-preprocessor',
        'karma-chrome-launcher',
        'karma-firefox-launcher'
     ]
  });
}
