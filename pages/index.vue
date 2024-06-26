<template>
  <div style="height: 100%; width: 100%">
    <loading :active="loading" />
    <div id="map" style="height: 100%; width: 100%" />
    <div
      ref="slider"
      class="mapboxgl-ctrl mapboxgl-ctrl-group mapboxgl-ctrl-timeline"
      style="display: flex; width: calc(100vw - 20px); justify-content: center;"
    >
      <div class="mapboxgl-ctrl-timeline__label">
        <b>{{ device && device.name }}</b>
      </div>
      <div class="mapboxgl-ctrl-timeline__control" style="flex-grow: 1">
        <button
          class="mapboxgl-ctrl-icon svg-button"
          style="background-image: url('backward.svg')"
          @click="clickBackward"
        />
        <button
          class="mapboxgl-ctrl-icon svg-button"
          :style="`background-image: url('${playing ? 'pause' : 'play'}.svg')`"
          @click="playing = !playing"
        />
        <button
          class="mapboxgl-ctrl-icon svg-button"
          style="background-image: url('forward.svg')"
          @click="clickForward"
        />
        <div class="mapboxgl-ctrl-timeline__label">
          <input v-model="from" type="datetime-local">
        </div>
        <div ref="noUiSlider" class="mapboxgl-ctrl-timeline__slider" :style="`background-image: url('${sliderBackground}');`" style="border: 0" />
        <div class="mapboxgl-ctrl-timeline__label">
          <input v-model="to" type="datetime-local">
        </div>
      </div>
      <div class="mapboxgl-ctrl-timeline__label">
        <select id="speeds" v-model="playSpeed" style="font-size: 1rem;">
          <option v-for="option in speeds" :key="option.value" :value="option.value">
            {{ option.text }}
          </option>
        </select>
        <input id="follow" v-model="follow" type="checkbox">
        <label for="follow">{{ $t('Follow') }}</label>
      </div>
    </div>
    <div ref="speedometer" class="mapboxgl-ctrl">
      <speedometer :speed="route[i] && route[i].speed * 1.852" />
    </div>
    <div ref="styleSwitcher">
      <style-switcher @changed="styleChanged" />
    </div>
    <canvas ref="sliderLine" style="position: absolute; left:-100000px" height="40" width="10000" />
  </div>
</template>

<script>
import { mapGetters } from 'vuex'
import bbox from '@turf/bbox'
import { feature, featureCollection, lineString, points } from '@turf/helpers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import Loading from 'vue-loading-overlay'
import { ScenegraphLayer } from '@deck.gl/mesh-layers'
import mapboxgl from 'mapbox-gl'
import { parse } from 'wellknown'
import flip from '@turf/flip'
import * as noUiSlider from 'nouislider'
import 'nouislider/dist/nouislider.css'
import { closest, green } from '@/utils'
import StyleSwitcher from '@/components/style-switcher.vue'
import Speedometer from '@/components/speedometer.vue'
import { get3dModel } from '@/utils/models3d'
const overlay = new MapboxOverlay({ layers: [] })

mapboxgl.accessToken = process.env.MAPBOX_ACCESS_TOKEN
let map
const boundsPadding = 100 // px
const maxAltitude = 400000
const maxLatitudeDistance = 6

function getLocalDateString (myDate) {
  if (myDate) {
    return myDate.getFullYear() + '-' +
      ('0' + (myDate.getMonth() + 1)).slice(-2) + '-' +
      ('0' + myDate.getDate()).slice(-2) + 'T' +
      ('0' + myDate.getHours()).slice(-2) + ':' +
      ('0' + myDate.getMinutes()).slice(-2)
  }
  return null
}

export default {
  name: 'IndexPage',
  components: { Speedometer, Loading, StyleSwitcher },
  data () {
    return {
      pitch: 30,
      imgId: 0,
      imgTime: '',
      imgSrc: '',
      imgLoaded: true,
      speeds: [
        { text: '1x', value: 400 },
        { text: '2x', value: 200 },
        { text: '5x', value: 80 },
        { text: '10x', value: 40 }
      ],
      loading: false,
      playing: false,
      i: 0,
      start: 0,
      playSpeed: 400,
      follow: false,
      sliderBackground: ''
    }
  },
  computed: {
    ...mapGetters(['devices', 'path', 'timestamps', 'route', 'showTerrain', 'showSigns', 'showBuildings', 'geofences']),
    cameraAltitude () {
      return maxAltitude / this.playSpeed
    },
    max () {
      return this.timestamps.slice(-1)[0]
    },
    min () {
      return this.timestamps[0]
    },
    device () {
      return this.devices.find(d => d.id === parseInt(this.$route.query.deviceId)) || this.devices[0]
    },
    currentTime: {
      get () { return this.timestamps[this.i] },
      set (time) { this.i = closest(this.timestamps, time) }
    },
    from: {
      get () { return getLocalDateString(this.$store.state.from && new Date(this.$store.state.from)) },
      set (value) { this.$store.commit('SET_FROM', value) }
    },
    to: {
      get () { return getLocalDateString(this.$store.state.to && new Date(this.$store.state.to)) },
      set (value) { this.$store.commit('SET_TO', value) }
    }
  },
  watch: {
    geofences () {
      const features = featureCollection(
        this.geofences
          .filter(g => parse(g.area))
          .map(g => feature(flip(parse(g.area)), { name: g.name }))
      )
      map.getSource('geofences').setData(features)
    },
    async from () {
      this.loading = true
      await this.$store.dispatch('getPath')
      this.loading = false
    },
    async to () {
      this.loading = true
      await this.$store.dispatch('getPath')
      this.loading = false
    },
    start () {
      this.updateRoute()
    },
    i () {
      this.updateRoute()
      if (this.path[this.i]) {
        if (this.playing) {
          this.updateSlider()
        }
        const model = get3dModel(this.device && this.device.category)
        overlay.setProps({
          layers: [new ScenegraphLayer({
            id: model,
            data: [{
              point: this.path[this.i],
              heading: this.route[this.i].course,
              altitude: map.queryTerrainElevation(this.path[this.i])
            }],
            scenegraph: model.scenegraph,
            sizeScale: model.sizeScale,
            getPosition: d => d.point,
            getTranslation: d => [0, 0, d.altitude],
            getOrientation: model.getOrientation,
            _lighting: 'pbr',
            sizeMinPixels: model.sizeMinPixels || 12
          })]
        })
        if (this.follow) {
          const camera = map.getFreeCameraOptions()
          camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
            [this.route[this.i].longitude, this.route[this.i].latitude - (maxLatitudeDistance / this.playSpeed)],
            this.cameraAltitude
          )
          camera.lookAtPoint(this.path[this.i])
          map.setFreeCameraOptions(camera)
        }
      }
    },
    path () {
      this.loading = false
      if (this.path && this.path.length) {
        map.getSource('route').setData(lineString(this.path))
        const bounds = bbox(points(this.path))
        map.fitBounds(bounds, { padding: boundsPadding, maxZoom: 15, pitch: this.pitch })
        this.updateSliderBackground()
        this.$refs.noUiSlider.noUiSlider.updateOptions({
          range: {
            min: this.min,
            max: this.max
          }
        })
        this.$refs.noUiSlider.noUiSlider.set([this.min, this.max])
      }
    },
    playing () {
      if (this.playing) {
        // const bounds = bbox(points(this.path))
        // init(bounds, this.path, map)
        if (this.i + 1 === this.path.length) { this.i = 0 }
        this.play()
      }
    },
    showTerrain () {
      if (this.showTerrain) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        })
        map.setTerrain({
          source: 'mapbox-dem',
          exaggeration: 1
        })
      } else {
        try {
          map.setTerrain()
          map.removeSource('mapbox-dem')
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(e)
        }
      }
    },
    showBuildings () {
      if (this.showBuildings) {
        // Insert the layer beneath any symbol layer.
        const layers = map.getStyle().layers
        const labelLayerId = layers.find(
          layer => layer.type === 'symbol' && layer.layout['text-field']
        ).id

        // The 'building' layer in the Mapbox Streets
        // vector tileset contains building height data
        // from OpenStreetMap.
        map.addLayer(
          {
            id: 'add-3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 15,
            paint: {
              'fill-extrusion-color': '#aaa',

              // Use an 'interpolate' expression to
              // add a smooth transition effect to
              // the buildings as the user zooms in.
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0,
                15.05,
                ['get', 'height']
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0,
                15.05,
                ['get', 'min_height']
              ],
              'fill-extrusion-opacity': 0.6
            }
          },
          labelLayerId)
      } else {
        map.removeLayer('buildings')
      }
    },
    showSigns () {
      if (this.showSigns) {
        map.addSource('signs', {
          type: 'vector',
          tiles: [
            `https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token=${process.env.MAPILLARY_ACCESS_TOKEN}`
          ]
        })
        map.addLayer({
          id: 'signs',
          type: 'symbol',
          'source-layer': 'traffic_sign',
          source: 'signs',
          layout: {
            'icon-image': ['get', 'value']
          }
        })
      } else {
        if (map.getLayer('signs')) {
          map.removeLayer('signs')
        }
        if (map.getSource('signs')) {
          map.removeSource('signs')
        }
      }
    }
  },
  mounted () {
    new ResizeObserver(this.updateSliderBackground).observe(this.$refs.noUiSlider)
    this.loading = true
    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12', // style URL
      zoom: localStorage.getItem('zoom'),
      center: localStorage.getItem('center') ? JSON.parse(localStorage.getItem('center')) : [0, 0],
      pitch: this.pitch
    })
    map.on('moveend', () => {
      localStorage.setItem('center', JSON.stringify(map.getCenter()))
      localStorage.setItem('zoom', map.getZoom())
    })
    map.on('style.load', this.styleLoaded)
    map.on('styleimagemissing', this.styleImageMissing)
    map.addControl({ onAdd: () => this.$refs.slider }, 'top-right')
    map.addControl({ onAdd: () => this.$refs.speedometer }, 'top-right')
    map.addControl(new mapboxgl.NavigationControl())
    map.addControl({ onAdd: () => this.$refs.styleSwitcher })
    map.addControl(overlay)
    noUiSlider.create(this.$refs.noUiSlider,
      {
        start: [this.min, this.max],
        connect: true,
        tooltips: [
          { to: value => new Date(value).toLocaleString() },
          { to: value => new Date(value).toLocaleString() }
        ],
        step: 1,
        pips: {
          mode: 'positions',
          values: [0, 50, 100],
          format: { to: value => new Date(value).toLocaleString() }
        },
        range: {
          min: this.min || 0,
          max: this.max || 0
        }
      })
    this.$refs.noUiSlider.noUiSlider.on('update', ([from, to]) => {
      this.currentTime = to
      this.start = closest(this.timestamps, from)
    })
  },
  methods: {
    updateRoute () {
      if (this.start >= 0 && this.i > (this.start + 1) && map.getSource('route')) {
        map.getSource('route').setData(lineString(this.path.slice(this.start, this.i)))
      }
    },
    updateSlider () {
      this.$refs.noUiSlider.noUiSlider.set([null, this.currentTime])
    },
    clickBackward () {
      if (this.i - 1 >= 0) {
        this.i--
        this.updateSlider()
      }
    },
    clickForward () {
      if (this.i + 1 < this.path.length) {
        this.i++
        this.updateSlider()
      }
    },
    styleImageMissing (e) {
      if (e.id.startsWith('regulatory')) {
        const img = new Image(20, 20)
        img.src = `signs/${e.id}.svg`
        img.onload = () => !map.hasImage(e.id) && map.addImage(e.id, img)
      }
    },
    styleChanged (style) {
      map.setStyle(style.uri)
    },
    updateSliderBackground () {
      const canvas = this.$refs.sliderLine
      if (canvas !== undefined && this.route) {
        const context = canvas.getContext('2d')
        let status = 0
        let linePosition = 0
        this.route.forEach((p) => {
          if (p.attributes.ignition && status !== 1 && p.speed) {
            // to DRIVING
            linePosition = this.newColoredLine(p, context, linePosition, status)
            status = 1
          }
          if (p.attributes.ignition && status !== 2 && !p.speed) {
            // to IDLE
            linePosition = this.newColoredLine(p, context, linePosition, status)
            status = 2
          }
          if (!p.attributes.ignition && status !== 0) {
            // to OFF
            linePosition = this.newColoredLine(p, context, linePosition, status)
            status = 0
          }
        })
        this.drawLine(context, linePosition, this.$refs.noUiSlider.clientWidth, -1)
        this.sliderBackground = canvas.toDataURL()
      }
    },
    drawLine (context, start, end, status) {
      context.beginPath()
      context.strokeStyle = {
        '-1': '#979797',
        0: '#ff0022',
        1: green,
        2: '#F9B218'
      }[status]
      context.lineWidth = 20
      context.moveTo(start, 10)
      context.lineTo(end, 10)
      context.stroke()
    },
    getEndIndex (date) {
      return this.$refs.noUiSlider.clientWidth * (new Date(date) - this.min) / (this.max - this.min)
    },
    newColoredLine (p, context, currentLinePosition, currentStatus) {
      const end = this.getEndIndex(p.fixTime)
      this.drawLine(context, currentLinePosition, end, currentStatus)
      return end
    },
    styleLoaded () {
      this.addLayers()
      this.$store.dispatch('getPath')
      process.env.COUNTRY && this.setWorldView(process.env.COUNTRY)
      this.$store.commit('SET_TERRAIN', false)
      this.$store.commit('SET_SIGNS', false)
      this.$store.commit('SET_BUILDINGS', false)
    },
    setWorldView (worldview) {
      map.setFilter('admin-0-boundary-disputed', [
        'all',
        ['==', ['get', 'disputed'], 'true'],
        ['==', ['get', 'admin_level'], 0],
        ['==', ['get', 'maritime'], 'false'],
        ['match', ['get', 'worldview'], ['all', worldview], true, false]
      ])
      map.setFilter('admin-0-boundary', [
        'all',
        ['==', ['get', 'admin_level'], 0],
        ['==', ['get', 'disputed'], 'false'],
        ['==', ['get', 'maritime'], 'false'],
        ['match', ['get', 'worldview'], ['all', worldview], true, false]
      ])
      map.setFilter('admin-0-boundary-bg', [
        'all',
        ['==', ['get', 'admin_level'], 0],
        ['==', ['get', 'maritime'], 'false'],
        ['match', ['get', 'worldview'], ['all', worldview], true, false]
      ])
      map.setFilter('country-label', [
        'all',
        ['match', ['get', 'worldview'], ['all', worldview], true, false]
      ])
    },
    addLayers () {
      map.addSource('geofences', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      })
      map.addLayer({
        id: 'geofences',
        type: 'fill',
        source: 'geofences',
        paint: {
          'fill-color': 'Tomato',
          'fill-opacity': 0.8
        }
      })
      map.addLayer({
        id: 'geofences-text',
        type: 'symbol',
        source: 'geofences',
        layout: {
          'text-size': 16,
          'text-field': ['get', 'name'],
          'text-allow-overlap': true
        },
        paint: {
          'text-color': 'black',
          'text-halo-color': 'white',
          'text-halo-width': 1
        }
      })
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#2d5f99',
          'line-width': 10
        },
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        }
      })
      map.addLayer({
        id: 'routeCasing',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#4882c5',
          'line-width': 5
        },
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        }
      })
    },
    play () {
      if (this.i + 1 < this.path.length && this.playing) {
        this.i++
        setTimeout(window.requestAnimationFrame, this.playSpeed, this.play)
      } else {
        this.playing = false
      }
    }
  }
}
</script>
<style>
.svg-button {
  border: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  pointer-events: auto !important;
  height: 32px !important;
  background-color: red;
}
.noUi-horizontal .noUi-tooltip  {bottom: -150%;}
.noUi-connect {
  background: rgba(0,0,0,0.3);
}
.noUi-pips {
  position: absolute;
  color: #999;
  text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;

}
</style>
