define([
    'utils/helpers',
    'utils/stretching',
    'playlist/playlist',
    'providers/providers',
    'underscore',
    'utils/eventdispatcher',
    'events/events',
    'events/states'
], function(utils, stretchUtils, Playlist, Providers, _, eventdispatcher, events, states) {

    // Defaults
    var _defaults = {
        autostart: false,
        controls: true,
        dragging : false,
        // debug: undefined,
        fullscreen: false,
        height: 320,
        mobilecontrols: false,
        mute: false,
        playlist: [],
        playlistposition: 'none',
        playlistsize: 180,
        playlistlayout: 'extended',
        repeat: false,
        // skin: undefined,
        stretching: stretchUtils.UNIFORM,
        width: 480,
        volume: 90
    };

    var Model = function(config) {
        var _this = this,
            // Video provider
            _providers,
            _provider,
            // Saved settings
            _cookies = utils.getCookies(),
            // Sub-component configurations
            _componentConfigs = {
                controlbar: {},
                display: {}
            },
            _currentProvider = utils.noop;

        function _parseConfig(config) {
            utils.foreach(config, function(i, val) {
                config[i] = utils.serialize(val);
            });
            return config;
        }

        _.extend(_this, new eventdispatcher());

        _this.config = _parseConfig(_.extend({}, _defaults, _cookies, config));

        _.extend(_this, _this.config, {
            state: states.IDLE,
            duration: -1,
            position: 0,
            buffer: 0
        });
        // This gets added later
        _this.playlist = [];

        _providers = new Providers(_this.config.primary);

        function _videoEventHandler(evt) {
            switch (evt.type) {
                case events.JWPLAYER_MEDIA_MUTE:
                    _this.mute = evt.mute;
                    break;
                case events.JWPLAYER_MEDIA_VOLUME:
                    _this.volume = evt.volume;
                    break;
                case events.JWPLAYER_PLAYER_STATE:
                    // These two states exist at a provider level, but the player itself expects BUFFERING
                    if (evt.newstate === states.LOADING || evt.newstate === states.STALLED) {
                        evt.newstate = states.BUFFERING;
                    }

                    _this.state = evt.newstate;
                    break;
                case events.JWPLAYER_MEDIA_BUFFER:
                    _this.buffer = evt.bufferPercent; // note value change
                    break;
                case events.JWPLAYER_MEDIA_TIME:
                    _this.position = evt.position;
                    _this.duration = evt.duration;
                    break;
            }

            _this.sendEvent(evt.type, evt);
        }

        _this.setVideoProvider = function(provider) {

            if (_provider) {
                _provider.removeGlobalListener(_videoEventHandler);
                var container = _provider.getContainer();
                if (container) {
                    _provider.remove();
                    provider.setContainer(container);
                }
            }

            _provider = provider;
            _provider.volume(_this.volume);
            _provider.mute(_this.mute);
            _provider.addGlobalListener(_videoEventHandler);
        };

        _this.destroy = function() {
            if (_provider) {
                _provider.removeGlobalListener(_videoEventHandler);
                _provider.destroy();
            }
        };

        _this.getVideo = function() {
            return _provider;
        };

        _this.seekDrag = function(state) {
            _this.dragging = state;
            if (state) {
                _provider.pause();
            } else {
                _provider.play();
            }
        };

        _this.setFullscreen = function(state) {
            state = !!state;
            if (state !== _this.fullscreen) {
                _this.fullscreen = state;
                _this.sendEvent(events.JWPLAYER_FULLSCREEN, {
                    fullscreen: state
                });
            }
        };

        // TODO: make this a synchronous action; throw error if playlist is empty
        _this.setPlaylist = function(playlist) {

            _this.playlist = Playlist.filterPlaylist(playlist, _providers, _this.androidhls);
            if (_this.playlist.length === 0) {
                _this.sendEvent(events.JWPLAYER_ERROR, {
                    message: 'Error loading playlist: No playable sources found'
                });
            } else {
                _this.sendEvent(events.JWPLAYER_PLAYLIST_LOADED, {
                    playlist: jwplayer(_this.id).getPlaylist()
                });
                _this.item = -1;
                _this.setItem(0);
            }
        };

        _this.setItem = function(index) {
            var newItem;
            var repeat = false;
            if (index === _this.playlist.length || index < -1) {
                newItem = 0;
                repeat = true;
            } else if (index === -1 || index > _this.playlist.length) {
                newItem = _this.playlist.length - 1;
            } else {
                newItem = index;
            }

            if (repeat || newItem !== _this.item) {
                _this.item = newItem;
                _this.sendEvent(events.JWPLAYER_PLAYLIST_ITEM, {
                    index: _this.item
                });

                // select provider based on item source (video, youtube...)
                var item = _this.playlist[newItem];
                var source = item && item.sources && item.sources[0];
                if (source === undefined) {
                    // source is undefined when resetting index with empty playlist
                    return;
                }
                var Provider = _providers.choose(source);
                if (!Provider) {
                    throw new Error('No suitable provider found');
                }

                // If we are changing video providers
                if (!(_currentProvider instanceof Provider)) {
                    _currentProvider = new Provider(_this.id);

                    _this.setVideoProvider(_currentProvider);
                }

                // this allows the Youtube provider to load preview images
                if (_currentProvider.init) {
                    _currentProvider.init(item);
                }
            }
        };

        _this.setVolume = function(newVol) {
            if (_this.mute && newVol > 0) {
                _this.setMute(false);
            }
            newVol = Math.round(newVol);
            if (!_this.mute) {
                utils.saveCookie('volume', newVol);
            }
            _this.volume = newVol;
            if (_provider) {
                _provider.volume(newVol);
            }
        };

        _this.setMute = function(state) {
            if (!utils.exists(state)) {
                state = !_this.mute;
            }
            utils.saveCookie('mute', state);
            _this.mute = state;

			// pulled in from the control bar
            if (_this.mute && _this.volume === 0) {
				_this.setVolume(20);
            }

            if (_provider) {
                _provider.mute(state);
            }
        };

        _this.componentConfig = function(name) {
            return _componentConfigs[name];
        };
    };

    return Model;

});