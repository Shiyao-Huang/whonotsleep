"use no memo";
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';
import { FRAME_PADDING_DP, STRIP_HEIGHT_DP, type RenderedImage } from './pipeline';

export const COLORS = {
  frame: '#0b0d1a',
  border: '#2a2f5a',
  strip: '#141833',
  text: '#c9c6ff',
  dim: '#6f6fa8',
  owl: '#ffb547',
  moon: '#ffe08a',
} as const;

export interface WidgetViewProps {
  image: RenderedImage | null;
  status: string;
  /** highlight strip (someone got caught) */
  alert?: boolean;
  /** true when I already said goodnight -> button says good morning */
  saidGoodnight?: boolean;
  /** no session: show the join hint instead of goodnight button */
  noSession?: boolean;
  /** shown in place of the image if rendering failed */
  fallbackText?: string;
}

/** Image area: the pixel PNG, clicking it opens the app. */
export function PixelImage({ image, fallbackText }: Pick<WidgetViewProps, 'image' | 'fallbackText'>) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        flex: 1,
        width: 'match_parent',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: '#070815',
        overflow: 'hidden',
      }}
    >
      {image ? (
        <ImageWidget
          clickAction="OPEN_APP"
          image={image.uri as `data:image${string}`}
          imageWidth={image.widthDp}
          imageHeight={image.heightDp}
          radius={10}
        />
      ) : (
        <TextWidget
          text={fallbackText ?? '🌙 zzz…'}
          style={{ fontSize: 14, color: COLORS.text, fontFamily: 'monospace', textAlign: 'center' }}
        />
      )}
    </FlexWidget>
  );
}

/** Slim status strip with the goodnight/morning click area. */
export function StatusStrip({
  height,
  status,
  alert,
  saidGoodnight,
  noSession,
  compact,
}: Pick<WidgetViewProps, 'status' | 'alert' | 'saidGoodnight' | 'noSession'> & { height: number; compact?: boolean }) {
  return (
    <FlexWidget
      style={{
        height,
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 2,
      }}
    >
      <FlexWidget clickAction="REFRESH" style={{ flex: 1, height: 'match_parent', justifyContent: 'center' }}>
        <TextWidget
          text={status}
          maxLines={1}
          truncate="END"
          allowFontScaling={false}
          style={{
            fontSize: compact ? 11 : 12,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            color: alert ? COLORS.owl : COLORS.text,
          }}
        />
      </FlexWidget>
      {noSession ? null : (
        <FlexWidget
          clickAction={saidGoodnight ? 'MORNING' : 'GOODNIGHT'}
          accessibilityLabel={saidGoodnight ? '早安' : '晚安'}
          style={{
            height: height - 4,
            paddingHorizontal: 8,
            borderRadius: 10,
            backgroundColor: COLORS.strip,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <TextWidget
            text={saidGoodnight ? '☀️' : compact ? '🌙' : '🌙 晚安'}
            allowFontScaling={false}
            style={{ fontSize: 12, color: COLORS.moon, fontWeight: 'bold' }}
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

export function WidgetFrame({ stripHeight, compact, ...p }: WidgetViewProps & { stripHeight: number; compact?: boolean }) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: COLORS.frame,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: FRAME_PADDING_DP,
        paddingBottom: 0,
        overflow: 'hidden',
      }}
    >
      <PixelImage image={p.image} fallbackText={p.fallbackText} />
      <StatusStrip
        height={stripHeight}
        status={p.status}
        alert={p.alert}
        saidGoodnight={p.saidGoodnight}
        noSession={p.noSession}
        compact={compact}
      />
    </FlexWidget>
  );
}

export function RoomWidget(props: WidgetViewProps) {
  return <WidgetFrame {...props} stripHeight={STRIP_HEIGHT_DP.RoomWidget} />;
}
