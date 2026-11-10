"use no memo";
import React from 'react';
import { STRIP_HEIGHT_DP } from './pipeline';
import { WidgetFrame, type WidgetViewProps } from './RoomWidget';

/** 2x2 widget: my desk zoomed in (small layout, focusId = me). */
export function MeWidget(props: WidgetViewProps) {
  return <WidgetFrame {...props} stripHeight={STRIP_HEIGHT_DP.MeWidget} compact />;
}
