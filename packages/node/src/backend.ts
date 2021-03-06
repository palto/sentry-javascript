import { Backend, DSN, Options, SentryError } from '@sentry/core';
import { getDefaultHub } from '@sentry/hub';
import { SentryEvent, SentryResponse } from '@sentry/types';
import { isError, isPlainObject } from '@sentry/utils/is';
import { limitObjectDepthToSize, serializeKeysToEventMessage } from '@sentry/utils/object';
import * as md5 from 'md5';
import { extractStackFromError, parseError, parseStack, prepareFramesForEvent } from './parsers';
import { HTTPSTransport, HTTPTransport } from './transports';

/**
 * Configuration options for the Sentry Node SDK.
 * @see NodeClient for more information.
 */
export interface NodeOptions extends Options {
  /** Callback that is executed when a fatal global error occurs. */
  onFatalError?(error: Error): void;

  /** Sets an optional server name (device name) */
  serverName?: string;
}

/** The Sentry Node SDK Backend. */
export class NodeBackend implements Backend {
  /** Creates a new Node backend instance. */
  public constructor(private readonly options: NodeOptions = {}) {}

  /**
   * @inheritDoc
   */
  public async eventFromException(exception: any, syntheticException: Error | null): Promise<SentryEvent> {
    let ex: any = exception;

    if (!isError(exception)) {
      if (isPlainObject(exception)) {
        // This will allow us to group events based on top-level keys
        // which is much better than creating new group when any key/value change
        const keys = Object.keys(exception as {}).sort();
        const message = `Non-Error exception captured with keys: ${serializeKeysToEventMessage(keys)}`;

        getDefaultHub().configureScope(scope => {
          scope.setExtra('__serialized__', limitObjectDepthToSize(exception as {}));
          scope.setFingerprint([md5(keys.join(''))]);
        });

        ex = syntheticException || new Error(message);
        (ex as Error).message = message;
      } else {
        // This handles when someone does: `throw "something awesome";`
        // We use synthesized Error here so we can extract a (rough) stack trace.
        ex = syntheticException || new Error(exception as string);
      }
    }

    const event: SentryEvent = await parseError(ex as Error);

    return event;
  }

  /**
   * @inheritDoc
   */
  public async eventFromMessage(message: string, syntheticException: Error | null): Promise<SentryEvent> {
    const event: SentryEvent = {
      fingerprint: [message],
      message,
    };

    if (this.options.attachStacktrace && syntheticException) {
      const stack = syntheticException ? await extractStackFromError(syntheticException) : [];
      const frames = await parseStack(stack);
      event.stacktrace = {
        frames: prepareFramesForEvent(frames),
      };
    }

    return event;
  }

  /**
   * @inheritDoc
   */
  public async sendEvent(event: SentryEvent): Promise<SentryResponse> {
    let dsn: DSN;

    if (!this.options.dsn) {
      throw new SentryError('Cannot sendEvent without a valid DSN');
    } else {
      dsn = new DSN(this.options.dsn);
    }

    const transportOptions = this.options.transportOptions ? this.options.transportOptions : { dsn };

    const transport = this.options.transport
      ? new this.options.transport({ dsn })
      : dsn.protocol === 'http'
        ? new HTTPTransport(transportOptions)
        : new HTTPSTransport(transportOptions);

    return transport.send(event);
  }

  /**
   * @inheritDoc
   */
  public storeBreadcrumb(): boolean {
    return true;
  }

  /**
   * @inheritDoc
   */
  public storeScope(): void {
    // Noop
  }
}
