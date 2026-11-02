<script setup lang="ts">
import { EFFECT_CATALOG, EFFECT_KINDS, type Effect, type EffectKind, type ParamValue } from '@lumen/schema'
import { css } from 'styled-system/css'
import { computed } from 'vue'
import { IconButton, Menu, SortableList, Switch, type MenuEntry, type SortableMove } from '~/ui'
import { effectParamEntries } from './composeModel'
import ParamFields from './ParamFields.vue'

/** An ordered effects chain: add by kind, reorder, enable, remove and edit typed params. */
const props = defineProps<{ effects: Effect[]; listId: string }>()

const emit = defineEmits<{
  add: [kind: EffectKind]
  remove: [effectId: string]
  move: [effectId: string, index: number]
  toggle: [effectId: string, enabled: boolean]
  param: [effectId: string, name: string, value: ParamValue]
}>()

const addItems = computed<MenuEntry[]>(() =>
  EFFECT_KINDS.map((kind) => ({ id: kind, label: EFFECT_CATALOG[kind].label, icon: 'lucide:wand-sparkles' })),
)

function onMove(move: SortableMove): void {
  const effect = props.effects[move.from.index]
  if (effect) emit('move', effect.id, move.to.index)
}

const header = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2', mb: '1' })
const caption = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const card = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '2', borderRadius: 'sm', bg: 'bg.subtle', w: 'full', minW: '0' })
const cardHead = css({ display: 'flex', alignItems: 'center', gap: '2' })
const cardTitle = css({ flex: '1', textStyle: 'ui.sm', color: 'fg.default', minW: '0' })
const empty = css({ textStyle: 'ui.xs', color: 'fg.subtle', py: '1' })
</script>

<template>
  <div>
    <div :class="header">
      <span :class="caption">{{ effects.length }} {{ effects.length === 1 ? 'effect' : 'effects' }}, applied top to bottom</span>
      <Menu :items="addItems" aria-label="Add effect" @select="(id) => emit('add', id as EffectKind)">
        <template #trigger="{ props: trigger }">
          <IconButton icon="lucide:plus" label="Add effect" size="sm" v-bind="trigger" />
        </template>
      </Menu>
    </div>
    <p v-if="effects.length === 0" :class="empty">No effects.</p>
    <SortableList
      v-else
      :items="effects"
      :list-id="listId"
      :group="listId"
      item-key="id"
      :item-label="(effect) => EFFECT_CATALOG[effect.kind].label"
      aria-label="Effects"
      @move="onMove"
    >
      <template #default="{ item: effect }">
        <div :class="card">
          <div :class="cardHead">
            <Switch
              :model-value="effect.enabled"
              size="sm"
              :aria-label="`Enable ${EFFECT_CATALOG[effect.kind].label}`"
              @update:model-value="emit('toggle', effect.id, $event)"
            />
            <span :class="cardTitle">{{ EFFECT_CATALOG[effect.kind].label }}</span>
            <IconButton icon="lucide:trash-2" label="Remove effect" size="sm" @click="emit('remove', effect.id)" />
          </div>
          <ParamFields
            :entries="effectParamEntries(effect.kind, effect.params)"
            @change="(name, value) => emit('param', effect.id, name, value)"
          />
        </div>
      </template>
    </SortableList>
  </div>
</template>
