<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Button } from '~/ui'

defineProps<{ message: string; title?: string; retryLabel?: string }>()
defineEmits<{ retry: []; dismiss: [] }>()

const root = css({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '3',
  p: '3',
  mb: '4',
  borderRadius: 'md',
  borderWidth: '1px',
  borderColor: 'danger.default',
  bg: 'bg.panel',
})
const mark = css({ color: 'danger.default', flexShrink: '0', mt: '0.5' })
const text = css({ flex: '1', minW: '0' })
const titleClass = css({ textStyle: 'ui.sm', color: 'fg.default' })
const messageClass = css({ mt: '0.5', textStyle: 'ui.xs', color: 'fg.muted', lineHeight: 'normal', wordBreak: 'break-word' })
</script>

<template>
  <div :class="root" role="alert">
    <Icon name="lucide:circle-alert" :size="16" :class="mark" aria-hidden="true" />
    <div :class="text">
      <p :class="titleClass">{{ title ?? 'Something went wrong' }}</p>
      <p :class="messageClass">{{ message }}</p>
    </div>
    <Button variant="secondary" size="sm" icon="lucide:refresh-cw" @click="$emit('retry')">
      {{ retryLabel ?? 'Try again' }}
    </Button>
    <Button variant="ghost" size="sm" @click="$emit('dismiss')">Dismiss</Button>
  </div>
</template>
