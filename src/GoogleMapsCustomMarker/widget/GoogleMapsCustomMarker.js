/*

    GoogleMapsCustomMarker
    ========================

    @file      : googlemapscustommarker.js
    @version   : 2.2.1
    @author    : Ivo Sturm
    @date      : 28-12-2017
    @copyright : First Consulting
    @license   : Apache v2

    Documentation
    ========================
    This is an extension to the default Mendix Google Maps widget, based on version 6.0.1 of the AppStore. Extra features are: toggling between drag and drop mode, markerclustering for multiple markers and customizing the infowindow and marker.
	
	Also changed is the way the markers are being fetched from the database. This version works better with large amounts of markers, because it is not calling a recursive function as is done in the default Google Maps widget, resulting in 'exceeding stack-size' errors.
	
	Releases
	========================
	v1.0 	Initial release.
	v1.1 	Mendix 7 fix for dom.input not being supported in Client API anymore. Now supported via html template.
			Added formatted address functionality when dragging a marker
			Fix for retrieving objects from DB. Was sometimes triggered twice
			Fix for widget sometimes not working when object not committed yet
			Added options 'Start Draggable' and 'Hide Toggle Dragging'
	v1.1.1 	Added disableInfoWindowDragging option to disable the infowindow popup after dragging.
	v1.2 	In case of reverse geocoding lacking results, the reason zero results are found is added in the pop-up
	v1.2.1 	Fix for API Key not sent in first API load
	v1.2.2 	Fix for locations with XPath to dataview entity the widget is placed in
	v2.0	Added support for lines between markers. Also added the possibility to only plot the line without markers. Thanks to Shana Lai on GitHub for forking and sharing.
	v2.0.1	Bugfix for refresh of page when contextobject is not the mapEntity object.
			Fix for when zooming to marker coming from cache, the default zoomlevel was not used, resulting in too high zoomlevel.
	v2.1	Added Get Objects MF and Get Objects Context Entity to cater for retrieving the objects from a microflow instead of database.
	v2.2.1	Added legend and legend attributes to create a legend when having custom colored or enumeration based markers
*/

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
    'GoogleMapsCustomMarker/lib/jsapi', 
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
		_infowindow: null,
		_logNode: 'GoogleMapsCustomMarker widget: ',
		_resizeTimer: null,

        postCreate: function () {
		
			// if dragging enabled, add on click event to checkbox
			if (this.toggleDraggingOpt){
				
				// start with checkbox checked if set from Modeler
				if  (this.startTogglingChecked){					
					this.toggleInput.checked = true;
				}
				
				// add toggling on click
				on(this.toggleInput,'change', lang.hitch(this, function(e) {
					this._toggleMarkerDragging(e);
				}));
				
				// hide toggling div if set from Modeler
				if  (this.hideTogglingDiv){
					this.toggleNodeDiv.style.display = 'none';
				}
				
			}
			// if dragging disabled, do not show the toggle dragging checkbox
			else {
				this.domNode.removeChild(this.toggleNodeDiv);
			}

        },
        update: function (obj, callback) {

            logger.debug(this.id + ".update");
			if (obj){
				this._contextObj = obj;			
            }
			
			this._resetSubscriptions();

            if (!google) {
                console.warn("Google JSAPI is not loaded, exiting!");
                callback();
                return;
            }

            if (!google.maps) {
                logger.debug(this.id + ".update load Google maps");
                var params = (this.apiAccessKey !== "") ? "key=" + this.apiAccessKey : "";
                if (google.loader && google.loader.Secure === false) {
                    google.loader.Secure = true;
                }
                window._googleMapsLoading = true;
                google.load("maps", 3, {
                    other_params: params,
                    callback: lang.hitch(this, function () {
                        logger.debug(this.id + ".update load Google maps callback");
                        window._googleMapsLoading = false;
                        this._loadMap(callback);
                    })
                });
            } else {
                if (this._googleMap) {
                    logger.debug(this.id + ".update has _googleMap");
                    this._fetchMarkers(callback);
                    google.maps.event.trigger(this._googleMap, "resize");
                } else {
                    logger.debug(this.id + ".update has no _googleMap");
                    if (window._googleMapsLoading) {
                        this._waitForGoogleLoad(callback);
                    } else {
                        this._loadMap(callback);
                    }
                }
            }
        },
        resize: function (box) {
            if (this._googleMap) {
                if (this._resizeTimer) {
                    clearTimeout(this._resizeTimer);
                }
                this._resizeTimer = setTimeout(lang.hitch(this, function () {
                    //logger.debug(this.id + ".resize");
                    google.maps.event.trigger(this._googleMap, "resize");
                    /*if (this.gotocontext) {
                        this._goToContext();
                    }*/
                }), 250);
            }
        },
       _waitForGoogleLoad: function (callback) {
            logger.debug(this.id + "._waitForGoogleLoad");
            var interval = null,
                i = 0,
                timeout = 5000; // We'll timeout if google maps is not loaded
            var intervalFunc = lang.hitch(this, function () {
                i++;
                if (i > timeout) {
                    logger.warn(this.id + "._waitForGoogleLoad: it seems Google Maps is not loaded in the other widget. Quitting");
                    this._executeCallback(callback);
                    clearInterval(interval);
                }
                if (!window._googleMapsLoading) {
                    this._loadMap(callback);
                    clearInterval(interval);
                }
            });
            interval = setInterval(intervalFunc, 1);
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
						// 20170611 - if contextobject is actual mapEntity object, no need to retrieve from DB again, since we have it already as context
						if (this._contextObj && this.mapEntity === this._contextObj.getEntity()){
							this.parseObjects([ this._contextObj ]);
						} else {
							this._loadMap();
						}
                    })
                });
            }
        },
        _loadMap: function (callback) {

			// load geocoder for reverse geocoding after dragging of marker
			this.geocoder = new google.maps.Geocoder();
			
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
			
			if (this.enableLegend){
				this._createLegend();
			}
			
			this._fetchMarkers();
			
			this._executeCallback(callback);

        },
		_createLegend : function(){
			
			var legendItemSize = 0;
			
			var legendDiv = dom.create("div",{
				id: 'googleMapsLegend',
				style : {
					backgroundColor : 'white',
					cursor     : "pointer",
					fontWeight : "bold",				
					border 		: "2px solid " + this.borderColor
			}});		
			
			// if Enum based marker images are used, base legend on those
			 if (this.markerImages.length > 1) {
				 var markerImageURL = null;
				 legendItemSize = this.markerImages.length;
				 
                dojoArray.forEach(this.markerImages, function (imageObj) {
					
					markerImageURL = imageObj.enumImage;
					
					var imageDiv = dom.create("div",{});
					var image = dom.create('img',
						{
							src : markerImageURL,
							style : {
								width : '25px',
								height : '25px',
								marginBottom : '5px'
							}
						}
					)
					var span = dom.create("text", imageObj.enumKey);
					span.style.marginLeft = '5px';
					imageDiv.appendChild(image);
					imageDiv.appendChild(span);
					legendDiv.appendChild(imageDiv);
                    
                });
            } else {
				// else get legend attributes from Legend Filling set in Modeler
				legendItemSize = this.legendAttributes.length;
				
				var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");	
				legendDiv.appendChild(svg);
				svg.setAttribute('width' ,'100');
				svg.setAttribute('height' ,legendItemSize * 30);
								
				for (var key = 0 ; key < legendItemSize ; key++) {
					var type = this.legendAttributes[key];
					var name = type.legendCaption;
					var color = type.legendColor;
					var icon = this.pinSymbol(color);

					var path = document.createElementNS("http://www.w3.org/2000/svg","path");  
					
					path.setAttributeNS(null, "d", icon.path);
							
					path.setAttributeNS(null, "stroke", icon.strokeColor); 
					path.setAttributeNS(null, "stroke-width", 1);  
					path.setAttributeNS(null, "opacity", 1);  
					path.setAttributeNS(null, "fill", icon.fillColor);
							  
					var text = document.createElementNS("http://www.w3.org/2000/svg","text");
					text.textContent = name;  
					text.setAttributeNS(null, "font-size","12px"); 
					text.setAttributeNS(null, "font-weight","normal");
					
					switch(this.markerSymbol) {
						case 'MARKER' :
							path.setAttributeNS(null, "transform", "translate(10," + (key + 1) * 30 + ") scale(0.7)" );
							text.setAttributeNS(null, "transform", "translate(25," + (((key + 1) * 30) - 10) + ")"); 						
							break;
						
						case 'STAR' :
							path.setAttributeNS(null, "transform", "translate(0," + (key) * 30 + ") scale(0.5)" ); 
							text.setAttributeNS(null, "transform", "translate(30," + (key + 0.5) * 30 + ")"); 
							break;
						case 'CIRCLE' :
							path.setAttributeNS(null, "transform", "translate(0," + (key) * 30 + ") scale(0.5)" ); 
							text.setAttributeNS(null, "transform", "translate(30," + (key + 0.5) * 30 + ")"); 
							break;
					}
					
					svg.appendChild(path);
					svg.appendChild(text);
				  
				}
			}
			
			legendDiv.style.height = legendItemSize * 30;
			
			this._googleMap.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(legendDiv);
			
		},
        _fetchMarkers: function () {

			this._markersArr = [];
			// 20170613 - Added check whether no context object is available. Pan to context was not properly working.
            if (this.gotocontext & !this._contextObj) {

                this._goToContext();
            } else if (this._contextObj && this.xpathConstraint.indexOf("[id='[%CurrentObject%]']") > -1){	

				this.parseObjects( [this._contextObj] );		
			} else {
                if (this.updateRefresh) {

                    this._fetchFromDBOrDS();
					
                } else {
                    if (this._markerCache) {
                        this._fetchFromCache();

                    } else {
                        this._fetchFromDBOrDS();

                    }
                }
            }

        },
        _refreshMap: function (objs) {

			var bounds = new google.maps.LatLngBounds();
            var panPosition = this._defaultPosition;
            var validCount = 0;
            var lineCoordinateList = [],
			lineCoordinate = null,
			valueOfLat = null,
			valueOfLng = null;
			
			// create markers
            dojoArray.forEach(objs, lang.hitch(this,function (obj) {
				
				if (this.hideMarkers && this.showLines){
					// don't plot markers when showLines = true and hideMarkers = true. In all other scenarios do plot markers.
				} else {
					this._addMarker(obj);
				}
                var position = this._getLatLng(obj);

                if (this.showLines && obj.lat && obj.lng) {
                    valueOfLat = parseFloat(obj.lat.valueOf());
                    valueOfLng = parseFloat(obj.lng.valueOf());
                    lineCoordinate = {lat: valueOfLat, lng: valueOfLng};     
                    lineCoordinateList.push(lineCoordinate);  
                }      

                if (position) {
                    bounds.extend(position);
                    validCount++;
                    panPosition = position;
                } else {
					
                    console.error(this._logNode + this.id + ": " + "Incorrect coordinates (" + obj.get(this.latAttr) +
                                  "," + obj.get(this.lngAttr) + ")");
					console.dir(this);
                }
				
            }));
			 
			// conditionally add a line between the markers baded on Modeler setting
            if (this.showLines) {
                if (this.lineOpacity) {
                    this.lineOpacity = Number(this.lineOpacity);
                } else {
                    this.lineOpacity = 1.0;
                }
                if (!this.lineColor){
                    this.lineColor = "#0595db";
                }
                if (!this.lineThickness){
                    this.lineThickness = 3;
                }
                var linePath = new google.maps.Polyline({
                  path: lineCoordinateList,
                  geodesic: true,
                  strokeColor: this.lineColor,
                  strokeOpacity: this.lineOpacity,
                  strokeWeight: this.lineThickness
                });

                linePath.setMap(this._googleMap);
            }
            
			if (validCount < 2) {
                this._googleMap.setZoom(this.lowestZoom);
                this._googleMap.panTo(panPosition);
            } else {
                this._googleMap.fitBounds(bounds);
            }
			
			if (this._progressID) {
				mx.ui.hideProgress(this._progressID);
				this._progressID = null;
            }
			
			if (this.enableMarkerClusterer && this._markersArr.length > 1){

				 var markerClustererOpts = {
					gridSize: this.MCGridSize,
					maxZoom: this.MCMaxZoom,
					zoomOnClick: true,
					imagePath: '../widgets/GoogleMapsCustomMarker/images/m'
				};

				this._markerClusterer = new MarkerClusterer(this._googleMap, this._markersArr, markerClustererOpts);

			} 
			// needed to set map again if markers where still in cache. if they where in cache then map would be null.
			else if (!this.enableMarkerClusterer && this._markersArr.length > 1){
				for (var q = 0 ; q < this._markersArr.length ; q++ ){
					this._markersArr[q].setMap(this._googleMap);
				}
			}

        },
        _fetchFromDBOrDS: function () {

			// if datasource microflow for objects is configured, use that to retrieve objects
			if (this.getObjectsMF && this._contextObj){
				if (this.consoleLogging){
					console.log('fetching from datasource microflow!');
				}
				mx.ui.action(this.getObjectsMF,{
					params: {
						applyto: 'selection',
						guids:[this._contextObj.getGuid()]
					},
					callback:  dojo.hitch(this,function(result) {
						this.parseObjects(result);
					}),	
					error: dojo.hitch(this,function(error) {

						console.log(error.description);
					})
				}, this);
			} else {
				if (this.consoleLogging){
					console.log('fetching from database!');
				}
				var xpath = '//' + this.mapEntity + this.xpathConstraint;
				
				this._schema = [];
				this._refs = {};
				
				this.loadSchema(this.markerDisplayAttr, 'marker');
				this.loadSchema(this.latAttr, 'lat');
				this.loadSchema(this.lngAttr, 'lng');
				this.loadSchema(this.colorAttr, 'color');
				this.loadSchema(this.formattedAddressAttr, 'address');
				this.loadSchema(this.enumAttr, 'enum');
				
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
						callback: dojo.hitch(this, function(result){
							this.parseObjects(result)
						})
					});
				} else if (!this._contextObj && (xpath.indexOf('[%CurrentObject%]') > -1)) {
					console.warn(this._logNode + 'No context for xpath, not fetching.');
				} else {
					mx.data.get({
						xpath: xpath,
						filter      : {
							attributes  : this._schema,
							references	: this._refs
						},
						callback:  dojo.hitch(this, function(result){
							this.parseObjects(result)
						})
					});
				}
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
		parseObjects : function (objs) {

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
				newObj['address'] = this.checkRef(objs[i], 'address', this.formattedAddressAttr);
				newObj['enum'] = this.checkRef(objs[i], 'enum', this.enumAttr);
				newObj['guid'] = objs[i].getGuid();						
				newObjs.push(newObj);
			}	
			if (this.consoleLogging){
					console.log(this._logNode + 'the MendixObjects retrieved:');
					console.dir(objs);
					console.log(this._logNode + 'the objects used for displaying on the map:');
					console.dir(newObjs);
			}
			
			// after creating the objects, trigger a refreshMap. This will also add the markers based on the newObjs	
			this._refreshMap(newObjs);

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

			if (this.consoleLogging){
				console.log('fetching from cache');
			}
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
					self._googleMap.setZoom(self.lowestZoom);
                }
            });
			


            if (!cached) {

                this._fetchFromDBOrDS();
            }

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
			
			var draggable = false;
			if (this.toggleInput && this.toggleInput.checked){
				draggable = true;
			}
            var id = this._contextObj ? this._contextObj.getGuid() : null,
                marker = new google.maps.Marker({
                    position: position,
					draggable : draggable,
					opacity : opacity	
                }),
                markerImageURL = null,
				objGUID = this._contextObj ? this._contextObj.getGuid() : null;

            if (id) {
                marker.id = id;
            }

            if (this.markerDisplayAttr) {
                marker.setTitle(obj.marker);
            }

            if (this.markerImages.length > 1) {
				// if marker images are configured and object has enum set
				if (obj.enum){
					dojoArray.forEach(this.markerImages, function (imageObj) {
						if (imageObj.enumKey === obj.enum) {
							markerImageURL = imageObj.enumImage;
							marker.setIcon(window.mx.appUrl + markerImageURL);
						}
					});
				// if marker images are configured but object has no enum set
				} else if (this.defaultIcon){
					// if no enum is empty, set to default icon
					markerImageURL = this.defaultIcon;
					marker.setIcon(window.mx.appUrl + markerImageURL);
				}
			// if marker images are not configured but default icon is set
            } else if(this.defaultIcon) {
                markerImageURL = this.defaultIcon;
				marker.setIcon(window.mx.appUrl + markerImageURL);
			// if no marker images are configured and no default icon is configured -> use color attribute
            } else {
				markerImageURL = this.pinSymbol(obj.color);
				marker.setIcon(markerImageURL);
			}
			
			if (!this.disableInfoWindow){
				google.maps.event.addListener(marker, "click", dojo.hitch(this, function() {
					if (this._infowindow){
						this._infowindow.close();
					}	
					var infowindow = new google.maps.InfoWindow({
						content : 	this.infoWindowNameLabel + ': <b>' +  obj.marker
						//+ this.colorAttr + ': <span style="background-color:' +  obj.color + ';width:12px;height:12px;display:inline-block"></span><br>'  
						//+ this.markerDisplayAttr + ': <i>' + obj.marker +'</i>'
					});
					
					infowindow.open(this._googleMap, marker);
					
					this._infowindow = infowindow;
					
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

							infowindow.setContent(this.infoWindowNameLabel + ': <b>' +  obj.marker + '<br><br>' + guidBtn.outerHTML);
							var btn = document.getElementById(guidBtn.id);

							on(btn,'click', dojo.hitch(this, function(e) {
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
					newLng = event.latLng.lng();
				// get actual mxObject based on guid of dragged marker	
				var mxObj = this._objects.filter(function( object ) {
				  return object.getGuid() == obj.guid;
				})[0];
				
				mxObj.set(this.latAttr,newLat.toFixed(8));
				mxObj.set(this.lngAttr,newLng.toFixed(8));
				
				// added in v1.1: store the formatted address of the location if attribute selected in modeler
				if (this.formattedAddressAttr){
					try{
						this._geocodePosition(marker,mxObj);
					} catch (e){
						console.error(this._logNode + e);
					}	
				}

			}));
			
			this._markersArr.push(marker);
			
            if (!this._markerCache) {
                this._markerCache = [];
            }
			// filter operation gives back a list, but since only one marker should with same guid should be in the markercache, we can take the first
			var oldMarker = this._markerCache.filter(lang.hitch(this,function(e) {
				return e.id === marker.id;
			}))[0];
			
			var index = this._markerCache.indexOf(oldMarker);

			if (index > -1){
				// existing marker, so delete old instance and remove from map
				this._markerCache.splice(index, 1);
				oldMarker.setMap(null);
			}  
				
			marker.setMap(this._googleMap);
			this._markerCache.push(marker);
				
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
		_geocodePosition: function (marker,mxObj) {
			
		  var position = marker.getPosition();
		  
		  this.geocoder.geocode({
			latLng: position
		  }, lang.hitch(this,function(results,status) {
			 if (this.consoleLogging){
				console.log(this._logNode + "results: ");
				console.dir(results);
				console.log(this._logNode + "status: " + status);
			 } 
			if (status === 'OK' && results.length > 0) {
			  var formattedAddress = results[0].formatted_address;
			  mxObj.set(this.formattedAddressAttr, formattedAddress);
			  marker.formatted_address = formattedAddress;
			} else {
			  marker.formatted_address = 'Cannot determine address at this location for the following reason: ' + status;
			}
			if (!this.disableInfoWindowDragend){
				if (this._infowindow){
					this._infowindow.close();
				}	
				var infowindow = new google.maps.InfoWindow();	
				this._infowindow = infowindow;
				this._infowindow.setContent("<b>" + marker.formatted_address + "</b>" + "<br> Drag the marker to update the formatted address field!");
				this._infowindow.open(this._googleMap, marker);			
			}
		  }));
		    
		},
        _goToContext: function () {
            this._removeAllMarkers();
            if (this._googleMap && this._contextObj) {
                this._refreshMap([ this._contextObj ]);
            }
        },
        _execMf: function (mf, guid, cb) {
			if (this.consoleLogging){
				console.log(this._logNode + "_execMf");
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
                    error: lang.hitch(this,function (error) {
                        console.debug(this._logNode + error.description);
                    })
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
					pathSymbol =  "M 20, 20 m -15, 0 a 15,15 0 1,0 30,0 a 15,15 0 1,0 -30,0";
  
					switch(this.markerSize){
						case 'L' :
							symbolScale = 1;
							break;
						case 'M' :
							symbolScale = 0.5;
							break;
						case 'S' :
							symbolScale = 0.3;
							break;
						case 'XS' :
							symbolScale = 0.2;
							break;
						case 'XXS' :
							symbolScale = 0.1;
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
				case 'STAR' :
					pathSymbol = 'M 25,1 31,18 49,18 35,29 40,46 25,36 10,46 15,29 1,18 19,18 z';
					switch(this.markerSize){
						case 'L' :
							symbolScale = 1;
							break;
						case 'M' :
							symbolScale = 0.5;
							break;
						case 'S' :
							symbolScale = 0.3;
							break;
						case 'XS' :
							symbolScale = 0.2;
							break;
						case 'XXS' :
							symbolScale = 0.1;
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
				
		},
		_executeCallback: function (cb) {
            if (cb && typeof cb === "function") {
                cb();
            }
        }
    });
});

require(["GoogleMapsCustomMarker/widget/GoogleMapsCustomMarker"], function() {});
