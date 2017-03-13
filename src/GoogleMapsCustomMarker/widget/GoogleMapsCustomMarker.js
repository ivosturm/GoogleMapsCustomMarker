/*jslint white:true, nomen: true, plusplus: true */
/*global mx, define, require, browser, devel, console, google, window */

/* 22-04-2016 Patrick Verhoeven (Appronto) : fix deprecations for Mendix 6 */

define([
    'dojo/_base/declare',
	"mxui/dom",
	"dojo/dom",	
	"dojo/on",
	'mxui/widget/_WidgetBase', 
	'dijit/_TemplatedMixin',
    'dojo/dom-style', 
	'dojo/dom-construct', 
	'dojo/_base/array', 
	'dojo/_base/lang',
    'GoogleMapsCustomMarker/lib/googlemaps!', 
	'dojo/text!GoogleMapsCustomMarker/widget/template/GoogleMaps.html',
	'GoogleMapsCustomMarker/lib/markerclustererlibrary'
], function (declare, dom, dojoDom, on,_WidgetBase, _TemplatedMixin, domStyle, domConstruct, dojoArray, lang, googleMaps, widgetTemplate) {
    'use strict';

    return declare('GoogleMapsCustomMarker.widget.GoogleMapsCustomMarker', [_WidgetBase, _TemplatedMixin], {
        templateString: widgetTemplate,
		
		_progressID: null,
		_markersArr: [],
		_objects: [],
		_markerClusterer		: null,
		_handle: null,
        _contextObj: null,
        _googleMap: null,
        _markerCache: null,
        _googleScript: null,
        _defaultPosition: null,
		_splits	: {},
		_refs : null,
		_schema : [],

        postCreate: function () {

            window[this.id + "_mapsCallback"] = lang.hitch(this, function () {
                this._loadMap();
            });

		if (this.toggleDraggingOpt){
			var toggleMarkerNode = dom.input({ type : 'checkbox', 'class' : 'toggleCheckBox'});
			var lbl =  '<label><b>Dragging enabled<b></label>';
			
			var toggleDiv = dom.div({ 'class': 'toggleDiv' }, toggleMarkerNode);
			
			var textNode = document.createElement("b");
			textNode.innerHTML = "Dragging enabled";

			toggleDiv.appendChild(textNode);
			
			on(toggleMarkerNode,'change', lang.hitch(this, function(e) {
				this._toggleMarkerDragging(e);
			}));
			
			this.domNode.appendChild(toggleDiv);
			
		}

            this._loadMap();
        },

        update: function (obj, callback) {

			if (this.showProgress) {
                //this._progressID = mx.ui.showProgress(this.progressMessage);
            }
			this._contextObj = obj;
            this._resetSubscriptions();
            if (this._googleMap) {
                this._fetchMarkers();
                google.maps.event.trigger(this._googleMap, 'resize');
            }

            callback();
        },

        resize: function (box) {
            if (this._googleMap) {
                google.maps.event.trigger(this._googleMap, 'resize');
            }
        },

        uninitialize: function () {
            window[this.id + "_mapsCallback"] = null;
        },

        _resetSubscriptions: function () {
            if (this._handle) {
                this.unsubscribe(this._handle);
                this._handle = null;
            }

            if (this._contextObj) {

                this._handle = this.subscribe({
                    guid: this._contextObj.getGuid(),
                    callback: lang.hitch(this, function (guid) {
                        this._fetchMarkers();
                    })
                });
            }
        },

        _loadMap: function () {
            domStyle.set(this.mapContainer, {
                height: this.mapHeight + 'px',
                width: this.mapWidth
            });

            this._defaultPosition = new google.maps.LatLng(this.defaultLat, this.defaultLng);

			var mapOptions = {
                zoom: 11,
                draggable: this.opt_drag,
                scrollwheel: this.opt_scroll,
                center: this._defaultPosition,
                mapTypeId: google.maps.MapTypeId[this.defaultMapType] || google.maps.MapTypeId.ROADMAP,
                mapTypeControl: this.opt_mapcontrol,
                mapTypeControlOption: {
                    style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR
                },
                streetViewControl: this.opt_streetview,
                zoomControl: this.opt_zoomcontrol,
                tilt: parseInt(this.opt_tilt.replace("d", ""), 10)
            };
            if (this.styleArray !== ""){
                mapOptions.styles = JSON.parse(this.styleArray);
            }
			
			if (this.borderColor !== ""){
				this.domNode.style.border = "2px solid " + this.borderColor;
			}
			
			this._googleMap = new google.maps.Map(this.mapContainer, mapOptions);

            this._fetchMarkers();

        },

        _fetchMarkers: function () {
            if (this.gotocontext) {
                this._goToContext();
            } else {
                if (this.updateRefresh) {

                    this._fetchFromDB();
					
                } else {
                    if (this._markerCache) {
                        this._fetchFromCache();
                    } else {
                        this._fetchFromDB();
                    }
                }
            }

        },

        _refreshMap: function (objs,contextObjs) {
			var self;
			if (contextObjs){
				self = contextObjs;
			} else {
				self = this;
			}

			var bounds = new google.maps.LatLngBounds();
            var panPosition = self._defaultPosition;
            var validCount = 0;
		
            dojoArray.forEach(objs, function (obj) {
                self._addMarker(obj);

                var position = self._getLatLng(obj);

                if (position) {
                    bounds.extend(position);
                    validCount++;
                    panPosition = position;
                } else {
					
                    console.error(self.id + ": " + "Incorrect coordinates (" + obj.get(self.latAttr) +
                                  "," + obj.get(self.lngAttr) + ")");
					console.dir(self);
                }
				

            });
			

            if (validCount < 2) {
                self._googleMap.setZoom(self.lowestZoom);
                self._googleMap.panTo(panPosition);
            } else {
                self._googleMap.fitBounds(bounds);
            }

			if (self._progressID) {
				mx.ui.hideProgress(self._progressID);
				self._progressID = null;
            }

        },

        _fetchFromDB: function () {
            var xpath = '//' + this.mapEntity + this.xpathConstraint;
			
			this._schema = [];
			this._refs = {};
			
			this.loadSchema(this.markerDisplayAttr, 'marker');
			this.loadSchema(this.latAttr, 'lat');
			this.loadSchema(this.lngAttr, 'lng');
			this.loadSchema(this.colorAttr, 'color');
			this.loadSchema(this.enumAttr, 'enum')
			
			// With empty _schema whole object is being pushed, this is a temporary fix
			if (this._schema.length == 0){
				this._schema.push('createdDate');
			}

            this._removeAllMarkers();

            if (this._contextObj) {
                xpath = xpath.replace('[%CurrentObject%]', this._contextObj.getGuid());
                mx.data.get({
                    xpath: xpath,
					filter      : {
						attributes  : this._schema,
						references	: this._refs
					},
                    callback: dojo.hitch(this, this.processObjectsList)
                });
            } else if (!this._contextObj && (xpath.indexOf('[%CurrentObject%]') > -1)) {
                console.warn('No context for xpath, not fetching.');
            } else {
                mx.data.get({
                    xpath: xpath,
					filter      : {
						attributes  : this._schema,
						references	: this._refs
					},
                    callback:  dojo.hitch(this, this.processObjectsList)
                });
            }
					
			
        },
		loadSchema : function (attr, name) {

			if (attr !== '') {
				this._splits[name] = attr.split("/");
				if (this._splits[name].length > 1)
					if (this._refs[this._splits[name][0]] && this._refs[this._splits[name][0]].attributes){
						this._refs[this._splits[name][0]].attributes.push(this._splits[name][2]);
					}
					else {
						this._refs[this._splits[name][0]] = {attributes : [this._splits[name][2]]};
					}
				else {
					this._schema.push(attr);
				}
			}
		}, 
		processObjectsList : function (objectsArr) {
			
			this.parseObjects(this._refreshMap,objectsArr);
			
			if (this.enableMarkerClusterer && this._markersArr.length > 1){
				 var markerClustererOpts = {
					gridSize: this.MCGridSize,
					maxZoom: this.MCMaxZoom,
					zoomOnClick: true,
					imagePath: '../widgets/GoogleMapsCustomMarker/images/m'
				};

				this._markerClusterer = new MarkerClusterer(this._googleMap, this._markersArr, markerClustererOpts);

			}

		},
		parseObjects : function (callback,objs) {
			this._objects = objs;
			var newObjs = [];
			for (var i = 0; i < objs.length; i++) {
				var newObj = {};
				var entity = objs[i].getEntity();	
				var entityString = entity.substr(entity.indexOf('.')+1);		
				newObj['type'] = entityString;								
				newObj['marker'] = this.checkRef(objs[i], 'marker', this.markerDisplayAttr);
				newObj['lat'] = this.checkRef(objs[i], 'lat', this.latAttr);
				newObj['lng'] = this.checkRef(objs[i], 'lng', this.lngAttr);
				newObj['color'] = this.checkRef(objs[i], 'color', this.colorAttr);
				newObj['enum'] = this.checkRef(objs[i], 'enum', this.enumAttr);
				newObj['guid'] = objs[i].getGuid();						
				newObjs.push(newObj);
			}	
			if (this.consoleLogging){
					console.log('the MendixObjects retrieved from the database:');
					console.dir(objs);
					console.log('the objects used for displaying on the map:');
					console.dir(newObjs);
			}
			if (callback && typeof(callback) == "function"){
				var self = this;
				callback(newObjs,self);

			}
			//return newObjs;
		},	
		checkRef : function (obj, attr, nonRefAttr) {
			if (this._splits && this._splits[attr] && this._splits[attr].length > 1) {
				var subObj = obj.getChildren(this._splits[attr][0]);
				return (subObj.length > 0)?subObj[0].get(this._splits[attr][2]):'';
			} else {
				return obj.get(nonRefAttr);
			}
		},		
        _fetchFromCache: function () {
            var self = this,
                cached = false,
                bounds = new google.maps.LatLngBounds();

            this._removeAllMarkers();

            dojoArray.forEach(this._markerCache, function (marker, index) {
                if (self._contextObj) {
				
                    if (marker.id === self._contextObj.getGuid()) {
                        marker.setMap(self._googleMap);
                        bounds.extend(marker.position);
                        cached = true;
                    }
                } else {
                    marker.setMap(self._googleMap);
                }
                if (index === self._markerCache.length - 1) {
                    self._googleMap.fitBounds(bounds);
                }
            });

            if (!cached) {
                this._fetchFromDB();
            }
			console.log('bounds from cache');

        },

        _removeAllMarkers: function () {
            if (this._markerCache) {
                dojoArray.forEach(this._markerCache, function (marker) {
                    marker.setMap(null);
                });
            }
			// Clears all clusters and markers from the clusterer.
			if (this._markerClusterer){
				this._markerClusterer.clearMarkers();
			}
			
        },

        _addMarker: function (obj) {

			var position = new google.maps.LatLng(obj.lat, obj.lng);
			var objGUID; 
			// needed to convert from string to number for Google
			var opacity = Number(this.opacity);
            var id = this._contextObj ? this._contextObj.getGuid() : null,
                marker = new google.maps.Marker({
                    position: position,
                    map: this._googleMap,
					draggable : false,
					opacity : opacity	
                }),
                self = this,
                markerImageURL = null,
                url = null;
				objGUID = this._contextObj ? this._contextObj.getGuid() : null;

            if (id) {
                marker.id = id;
            }

            if (this.markerDisplayAttr) {
                marker.setTitle(obj.marker);
            }

            if (this.markerImages.length > 1) {
                dojoArray.forEach(this.markerImages, function (imageObj) {
                    if (imageObj.enumKey === obj.enum) {
                        markerImageURL = imageObj.enumImage;
						marker.setIcon(window.mx.appUrl + markerImageURL);
                    }
                });
            } else if(this.defaultIcon) {
                markerImageURL = this.defaultIcon;
				marker.setIcon(window.mx.appUrl + markerImageURL);
            } else {
				markerImageURL = this.pinSymbol(obj.color);
				marker.setIcon(markerImageURL);
			}
			
			if (!this.disableInfoWindow){
				google.maps.event.addListener(marker, "click", dojo.hitch(this, function() {
					if (this.infowindow){
						this.infowindow.close();
					}	
					var infowindow = new google.maps.InfoWindow({
						content : 	'Overweg: <b>' +  obj.marker
						//+ this.colorAttr + ': <span style="background-color:' +  obj.color + ';width:12px;height:12px;display:inline-block"></span><br>'  
						//+ this.markerDisplayAttr + ': <i>' + obj.marker +'</i>'
					});
					
					infowindow.open(this._googleMap, marker);
					
					this.infowindow = infowindow;
					
					if (this.onClickMarkerMicroflow){
						var objGuid = obj.guid;
						
						var guidBtnOptions = {
							"class" : "glyphicon glyphicon-share-alt",
							"type" : "button",
							"id" : objGuid,
							"style" : "cursor : pointer"
						};
						
						var guidBtn = dom.create("button", guidBtnOptions);
						
						google.maps.event.addListener(infowindow, 'domready', dojo.hitch(this,function() { // infowindow object is loaded into DOM async via Google, hence need to target the domready event

							infowindow.setContent('Overweg: <b>' +  obj.marker + '<br><br>' + guidBtn.outerHTML);
							var btn = document.getElementById(guidBtn.id);

							on(btn,'click', dojo.hitch(this, function(e) {
								//console.log('clicked!');
								this._execMf(this.onClickMarkerMicroflow, objGuid);
							}));

						}));				
					}
				}));
			} else if (this.onClickMarkerMicroflow) {
                marker.addListener("click", lang.hitch(this, function () {
                    this._execMf(this.onClickMarkerMicroflow, obj.guid);
                }));
            }			
			// also add dragend eventlistener for when draggable is set to true
				
			google.maps.event.addListener(marker, 'dragend', lang.hitch(this, function (event){
				
				var newLat = event.latLng.lat(),
					newLng = event.latLng.lng(),
					validated = 0;
				// get actual mxObject based on guid of dragged marker	
				var mxObj = this._objects.filter(function( object ) {
				  return object.getGuid() == obj.guid;
				})[0];
				mxObj.set(this.latAttr,newLat.toFixed(8));
				mxObj.set(this.lngAttr,newLng.toFixed(8));

			}));
			this._markersArr.push(marker);
            if (!this._markerCache) {
                this._markerCache = [];
            }
            if (dojoArray.indexOf(this._markerCache, marker) === -1) {
                this._markerCache.push(marker);
            }
        },

        _getLatLng: function (obj) {
            var lat = obj.lat,
                lng = obj.lng;

            if (lat === "" && lng === "") {
                return this._defaultPosition;
            } else if (!isNaN(lat) && !isNaN(lng) && lat !== "" && lng !== "") {
                return new google.maps.LatLng(lat, lng);
            } else {
                return null;
            }
        },

        _goToContext: function () {
            this._removeAllMarkers();
            if (this._googleMap && this._contextObj) {
                this._refreshMap([ this._contextObj ]);
            }
        },
        _execMf: function (mf, guid, cb) {
			if (this.consoleLogging){
				console.log(this.id + "_execMf");
			}
            if (mf && guid) {
                mx.data.action({
                    params: {
                        applyto: "selection",
                        actionname: mf,
                        guids: [guid]
                    },
                    store: {
                        caller: this.mxform
                    },
                    callback: lang.hitch(this, function (obj) {
                        if (cb && typeof cb === "function") {
                            cb(obj);
                        }
                    }),
                    error: function (error) {
                        console.debug(error.description);
                    }
                }, this);
            }
        },
		pinSymbol : function(color) {
		
			var pathSymbol;
			var symbolScale;
			var symbolOpt;

			switch(this.markerSymbol) {
				case 'MARKER' :
					pathSymbol = 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z M -2,-30 a 2,2 0 1,1 4,0 2,2 0 1,1 -4,0';
					switch(this.markerSize){
						case 'L' :
							symbolScale = 1;
							break;
						case 'M' :
							symbolScale = 0.8;
							break;
						case 'S' :
							symbolScale = 0.5;
							break;
						case 'XS' :
							symbolScale = 0.3;
							break;
						case 'XXS' :
							symbolScale = 0.1;
							break;
					}		
					break;
				case 'CIRCLE' :
					pathSymbol = google.maps.SymbolPath.CIRCLE;
					switch(this.markerSize){
						case 'L' :
							symbolScale = 10;
							break;
						case 'M' :
							symbolScale = 8;
							break;
						case 'S' :
							symbolScale = 5;
							break;
						case 'XS' :
							symbolScale = 3;
							break;
						case 'XXS' :
							symbolScale = 1;
							break;
					}		
					break;
				case 'BACKWARD_CLOSED_ARROW' :
					pathSymbol = google.maps.SymbolPath.BACKWARD_CLOSED_ARROW;
					switch(this.markerSize){
						case 'L' :
							symbolScale = 10;
							break;
						case 'M' :
							symbolScale = 8;
							break;
						case 'S' :
							symbolScale = 5;
							break;
						case 'XS' :
							symbolScale = 3;
							break;
						case 'XXS' :
							symbolScale = 1;
							break;
					}
					break;				
				case 'BACKWARD_OPEN_ARROW' :
					pathSymbol = google.maps.SymbolPath.BACKWARD_OPEN_ARROW;
					switch(this.markerSize){
						case 'L' :
							symbolScale = 10;
							break;
						case 'M' :
							symbolScale = 8;
							break;
						case 'S' :
							symbolScale = 5;
							break;
						case 'XS' :
							symbolScale = 3;
							break;
						case 'XXS' :
							symbolScale = 1;
							break;
					}
					break;
				case 'FORWARD_CLOSED_ARROW' :
					pathSymbol = google.maps.SymbolPath.FORWARD_CLOSED_ARROW;
					switch(this.markerSize){
						case 'L' :
							symbolScale = 10;
							break;
						case 'M' :
							symbolScale = 8;
							break;
						case 'S' :
							symbolScale = 5;
							break;
						case 'XS' :
							symbolScale = 3;
							break;
						case 'XXS' :
							symbolScale = 1;
							break;
					}
					break;
				case 'FORWARD_OPEN_ARROW' :
					pathSymbol = google.maps.SymbolPath.FORWARD_OPEN_ARROW;
					switch(this.markerSize){
						case 'L' :
							symbolScale = 10;
							break;
						case 'M' :
							symbolScale = 8;
							break;
						case 'S' :
							symbolScale = 5;
							break;
						case 'XS' :
							symbolScale = 3;
							break;
						case 'XXS' :
							symbolScale = 1;
							break;
					}	
					break;
			}
			
			symbolOpt = {
				path: pathSymbol,
				fillColor: color,
				fillOpacity: 1,
				strokeColor: '#000',
				strokeWeight: 1,
				scale: symbolScale
			};
		
			return symbolOpt;
		},
		_toggleMarkerDragging : function(event){
			var node = event.target;
			for (var j=0;j<=this._markersArr.length;j++){
					if	(node.checked && typeof this._markersArr[j] !== "undefined") {
						this._markersArr[j].setDraggable(true);
					} else if (typeof this._markersArr[j] !== "undefined"){
						this._markersArr[j].setDraggable(false);
					} else {
					}				
				}
				
		}
    });
});

require(["GoogleMapsCustomMarker/widget/GoogleMapsCustomMarker"], function() {});
