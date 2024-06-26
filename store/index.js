import { prettify } from '@/utils'

export const state = {
  session: null,
  devices: [],
  timestamps: [],
  path: [],
  headings: [],
  route: [],
  geofences: [],
  showTerrain: false,
  showSigns: false,
  showBuildings: false,
  from: null,
  to: null
}
export const getters = {
  devices: state => state.devices,
  path: state => state.path,
  timestamps: state => state.timestamps,
  route: state => state.route,
  geofences: state => state.geofences,
  showTerrain: state => state.showTerrain,
  showSigns: state => state.showSigns,
  showBuildings: state => state.showBuildings
}
export const actions = {
  async getUserData ({ commit }) {
    commit('SET_DEVICES', await this.$axios.$get('devices'))
    commit('SET_SESSION', await this.$axios.$get('session'))
    commit('SET_SESSION', await this.$axios.$get('session'))
    commit('SET_GEOFENCES', await this.$axios.$get('/geofences'))
  },
  async getPath ({ commit, dispatch, state }) {
    const query = new URLSearchParams(window.location.search)
    const from = new Date(state.from || query.get('from') || new Date().getTime() - 1000 * 60 * 60 * 24).toISOString()
    const to = new Date(state.to || query.get('to') || new Date().getTime() + 1000 * 60 * 60 * 24).toISOString()
    await dispatch('getUserData')
    const device = state.devices.filter(d => d && d.id).find(d => d.id === parseInt(query.get('deviceId'))) || state.devices[0]
    const _route = await this.$axios.$get(`/reports/route?deviceId=${device.id}&from=${from}&to=${to}`)
    const route = prettify(_route, 1)
    if (!state.from) { commit('SET_FROM', from) }
    if (!state.to) { commit('SET_TO', to) }
    commit('SET_ROUTE', route)
    commit('SET_PATH', route.map(p => [p.longitude, p.latitude]))
    commit('SET_TIMESTAMPS', route.map(p => new Date(p.fixTime).getTime()))
    this.loading = false
  }
}
export const mutations = {
  SET_TERRAIN (state, value) { state.showTerrain = value },
  SET_BUILDINGS: (state, value) => { state.showBuildings = value },
  SET_SIGNS: (state, value) => { state.showSigns = value },
  SET_SESSION (state, session) {
    state.session = session
  },
  SET_DEVICES (state, devices) {
    state.devices = devices
  },
  SET_TIMESTAMPS (state, timestamps) {
    state.timestamps = timestamps
  },
  SET_PATH (state, path) {
    state.path = path
  },
  SET_ROUTE (state, route) {
    state.route = route
  },
  SET_GEOFENCES (state, geofences) {
    state.geofences = geofences
  },
  SET_FROM (state, from) {
    state.from = from
  },
  SET_TO (state, to) {
    state.to = to
  }
}
