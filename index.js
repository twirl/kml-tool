ymaps.modules.define('kmlTool.start', [
    'Map',
    'kmlTool.State',
    'kmlTool.View'
], function (provide, Map, State, View) {
    provide(function () {
        var state = new State(),
            map = new ymaps.Map('map', state.get('map'));

        map.cursors.push('arrow');

        var view = new View(document.getElementById('objects-view'), state, map);

        map.events.add('click', function (e) {
            view.addNewObject(e.get('coords'));
        });
    });
});

ymaps.modules.define('kmlTool.State', [
    'util.defineClass',
    'Event',
    'data.Manager',
    'kmlUtil.kmlTemplate'
], function (provide, defineClass, Event, DataManager, kmlTemplate) {
    function State () {
        var query = document.location.search.replace(/^\?/, ''),
            state;

        if (query) {
            state = JSON.parse(base64.urldecode(query));
        } else {
            state = {
                map: {},
                geoObjects: [],
                editing: false
            };
        }

        state.map.center = [30.063572, 59.897329];
        state.map.zoom = 9;

        State.superclass.constructor.call(this, state);
        this.events.add(['push', 'update', 'delete', 'mapstatechange'], this._updateLink, this);
    }

    defineClass(State, DataManager, {
        pushObject: function (data) {
            this.get('geoObjects').push(data);
            this.events.fire('push', new Event({
                newObject: data
            }));
        },

        updateObject: function (index, data) {
            this.get('geoObjects')[index] = data;
            this.events.fire('update', new Event({
                index: index
            }));
        },

        deleteObject: function (index) {
            this.get('geoObjects').splice(index, 1);
            this.events.fire('delete', new Event({
                index: index
            }));
        },

        getKmlHref: function () {
            return kmlTemplate.build(this).text;
        },

        _updateLink: function () {
            var data = this.getAll();
            window.history.pushState(data, '', '?' + base64.urlencode(JSON.stringify(data)));
        }
    });

    provide(State);
});

ymaps.modules.define('kmlTool.BalloonContentLayout', [
    'templateLayoutFactory'
], function (provide, templateLayoutFactory) {
    var Layout = templateLayoutFactory.createClass([
            '<div id="edit-balloon">',
            'Метка #{{ properties.iconContent }}:<br/>',
            '<textarea id="object-content">{{ properties.balloonContent|defaultValue:"" }}</textarea><br/>',
            '<button id="save-button">Сохранить</button>',
            '<button id="delete-button">Удалить</button>',
            '</div>'
        ].join(''));

    provide(Layout);
});

ymaps.modules.define('kmlTool.preset', [
    'kmlTool.BalloonContentLayout'
], function (provide, BalloonContentLayout) {
    provide({
        balloonOffset: [2, -38],
        balloonContentLayout: BalloonContentLayout,
        draggable: true,
        hideIconOnBalloonOpen: false,
        preset: 'islands#blueIcon',
        ballonPanelMaxMapArea: 0
    });
});

ymaps.modules.define('kmlTool.View', [
    'util.defineClass',
    'GeoObjectCollection',
    'Placemark',
    'kmlTool.preset',
    'Event',
    'domEvent.manager'
], function (provide, defineClass, GeoObjectCollection, Placemark, preset, Event, domEventManager) {
    var View = defineClass(function (element, state, map) {
        this._element = element;
        this._state = state;
        this._markers = new GeoObjectCollection();
        map.geoObjects.add(this._markers);

        this._renderObjects();

        var mapEdit = document.getElementById('map-name-edit');
        mapEdit.value = state.get('map.name') || '';
        mapEdit.addEventListener('input', function () {
            state.set('map.name', mapEdit.value);
            state.events.fire('mapstatechange', new Event({}));
        });

        state.events
            .add('push', this._onPushObject, this)
            .add('delete', this._onDeleteObject, this)
            .add('update', this._onUpdateObject, this);

        this._markers.events
            .add('balloonopen', function (e) {
                this._setupUpdateTracking(this._markers.indexOf(e.get('target')));
                document.getElementById('object-content').focus();
            }, this)
            .add('balloonclose', function () {
                this._saveListener.removeAll();
                this._deleteListener.removeAll();
            }, this);

        this._trackingIndex = -1;

        var a = document.getElementById('get-code');
        domEventManager.add(a, 'mousedown', function () {
            a.href = this._state.getKmlHref();
        }, this);
    }, {
        _renderObjects: function () {
            var objects = this._state.get('geoObjects'),
                html = objects.map(function (object) {
                    return '<li>' + this._formatObject(object) + '</li>';
                }.bind(this)).join(''),
                markers = this._markers,
                createPlacemark = this._createPlacemark.bind(this);

            this._element.innerHTML = html;

            objects.forEach(function (data, index) {
                markers.add(createPlacemark(data, index));
            });
        },

        _onPushObject: function (e) {
            var li = document.createElement('li'),
                data = e.get('newObject');

            li.innerHTML = this._formatObject(data);
            this._element.appendChild(li);

            this._markers.add(this._createPlacemark(data, this._state.get('geoObjects').length - 1));
        },

        _onDeleteObject: function () {
            this._markers.removeAll();
            this._renderObjects();
        },

        _onUpdateObject: function (e) {
            var index = e.get('index'),
                li = this._element.childNodes[index],
                data = this._state.get('geoObjects')[index];

            li.innerHTML = this._formatObject(data);
        },

        _formatObject: function (object) {
            return object.content.length < 40 ? object.content : object.content.slice(0, 39) + '…';
        },

        _createPlacemark: function (data, index) {
            return new Placemark(data.position, {
                iconContent: (index + 1).toString(),
                balloonContent: data.content
            }, preset);
        },

        addNewObject: function (position) {
            var index = this._state.get('geoObjects').length,
                newObject = this._createPlacemark({
                    position: position,
                    content: 'Без названия'
                }, index);

            this._markers.add(newObject);
            newObject.balloon.open();
        },

        _setupUpdateTracking: function (index) {
            this._trackingIndex = index;

            this._saveListener = domEventManager.group(
                document.getElementById('save-button')
            ).add('click', this._saveObject, this);
            this._deleteListener = domEventManager.group(
                document.getElementById('delete-button')
            ).add('click', this._deleteObject, this);
        },

        _saveObject: function () {
            var index = this._trackingIndex,
                marker = this._markers.get(index),
                data = {
                    position: marker.geometry.getCoordinates(),
                    content: document.getElementById('object-content').value
                };

            this._teardownUpdateTracking();

            if (index >= this._state.get('geoObjects').length) {
                this._markers.remove(marker);
                this._state.pushObject(data);
            } else {
                this._state.updateObject(index, data);
                marker.balloon.close();
            }
        },

        _deleteObject: function () {
            var marker = this._markers.get(this._trackingIndex),
                index = this._trackingIndex;

            this._teardownUpdateTracking();

            if (index >= this._state.get('geoObjects').length) {
                this._markers.remove(marker);
            } else {
                this._state.deleteObject(index);
            }
        },

        _teardownUpdateTracking: function () {
            this._trackingIndex = -1;
        }
    });

    provide(View);
});

ymaps.modules.define('kmlUtil.kmlTemplate', [
    'Template'
], function (provide, Template) {
    provide(new Template([
        'data:text/kml;utf-8,<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder>',
        '<name>{{ map.name }}</name>',
        '<description/>',
        '{% for geoObject in geoObjects %}',
            '<Placemark>',
                '<name>{{ geoObject.content }}</name>',
                '<description/>',
                '<Style><IconStyle>',
                    '<Icon><href>https://api-maps.yandex.ru/i/0.4/micro/pmlbs.png</href></Icon>',
                    '<hotSpot x="7" y="28" xunits="pixels" yunits="insetPixels"/>',
                '</IconStyle></Style>',
                '<Point>',
                    '<coordinates>{{ geoObject.position.0 }},{{ geoObject.position.1 }}</coordinates>',
                '</Point>',
            '</Placemark>',
        '{% endfor %}',
        '</Folder></Document></kml>'
    ].join('')));
});
