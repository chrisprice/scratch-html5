// Copyright (C) 2013 Massachusetts Institute of Technology
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 2,
// as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

// Scratch HTML5 Player
// PlayerDOM.js
// Chris Price, June 2014

// Here we define the DOM structure used by the player.
// All DOM references should be rooted here.

'use strict';

var $ = require('jquery'),
	fs = require('fs');

function PlayerDOM() {
	this.window = null;
	this.document = null;
	this.root = null;

	this.upArrow = null;
	this.rightArrow = null;
	this.downArrow = null;
	this.leftArrow = null;

	this.header = null;
	this.preload = null;
	this.version = null;
	this.fullscreen = null;
	this.stop = null;
	this.greenFlag = null;

	this.content = null;
	this.contentContainer = null;
	this.contentOverlay = null;

	this.preloader = null;
	this.preloaderProgress = null;
	this.preloaderProgressBar = null;
	this.preloaderCaption = null;
	this.preloaderDetails = null;
}

PlayerDOM.prototype.createElements = function(root) {
	// Don't just use document/window in case we've been added to an popup
	this.root = $(root);
	this.document = $(this.root[0].ownerDocument);
	this.window = $(this.document[0].defaultView || this.document[0].parentWindow);

	var html = fs.readFileSync(__dirname + '/../html/player.html', 'utf8');
	this.root.addClass('scratch-player-container').html(html);
	var css = fs.readFileSync(__dirname + '/../css/player.css', 'utf8');
	this.document.find('head').append('<style>' + css + '</style>');

	this.upArrow = this.root.find('.scratch-player-arrow-up');
	this.rightArrow = this.root.find('.scratch-player-arrow-right');
	this.downArrow = this.root.find('.scratch-player-arrow-down');
	this.leftArrow = this.root.find('.scratch-player-arrow-left');

	this.header = this.root.find('.scratch-player-header');
	this.preload = this.root.find('.scratch-player-header-preload');
	this.version = this.root.find('.scratch-player-header-version');
	this.fullscreen = this.root.find('.scratch-player-toggle-fullscreen');
	this.stop = this.root.find('.scratch-player-trigger-stop');
	this.greenFlag = this.root.find('.scratch-player-trigger-green-flag');

	this.content = this.root.find('.scratch-player-content');
	this.contentContainer = this.root.find('.scratch-player-content-container');
	this.contentOverlay = this.root.find('.scratch-player-content-overlay');

	this.preloader = this.root.find('.scratch-player-preloader');
	this.preloaderProgress = this.root.find('.scratch-player-preloader-progress');
	this.preloaderProgressBar = this.root.find('.scratch-player-preloader-progress-bar');
	this.preloaderCaption = this.root.find('.scratch-player-preloader-caption');
	this.preloaderDetails = this.root.find('.scratch-player-preloader-details');
};

module.exports = PlayerDOM;
