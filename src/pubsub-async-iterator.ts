import { $$asyncIterator } from 'iterall';
import { MQTTPubSub, IDynamicSubscription } from './mqtt-pubsub';

/**
 * A class for digesting PubSubEngine events via the new AsyncIterator interface.
 * This implementation is a generic version of the one located at
 * https://github.com/apollographql/graphql-subscriptions/blob/master/src/event-emitter-to-async-iterator.ts
 * @class
 *
 * @constructor
 *
 * @property pullQueue @type {Function[]}
 * A queue of resolve functions waiting for an incoming event which has not yet arrived.
 * This queue expands as next() calls are made without PubSubEngine events occurring in between.
 *
 * @property pushQueue @type {any[]}
 * A queue of PubSubEngine events waiting for next() calls to be made.
 * This queue expands as PubSubEngine events arrice without next() calls occurring in between.
 *
 * @property eventsArray @type {string[]}
 * An array of PubSubEngine event names which this PubSubAsyncIterator should watch.
 *
 * @property allSubscribed @type {Promise<number[]>}
 * A promise of a list of all subscription ids to the passed PubSubEngine.
 *
 * @property listening @type {boolean}
 * Whether or not the PubSubAsynIterator is in listening mode (responding to incoming PubSubEngine events and next() calls).
 * Listening begins as true and turns to false once the return method is called.
 *
 * @property pubsub @type {PubSubEngine}
 * The PubSubEngine whose events will be observed.
 */
export class PubSubAsyncIterator<T> implements AsyncIterator<T> {

  private pullQueue: Function[];
  private pushQueue: any[];
  private eventsArray: string[];
  private allSubscribed: Promise<number[]>;
  private listening: boolean;
  private pubsub: MQTTPubSub;
  private subscribedPromises: Promise<number>[];
  // This function must be pure, it must return 
  // same output for a specific input irrespectively.
  private extractMessage: (any) => any;

  constructor(pubsub: MQTTPubSub, eventNames: string | string[], extractMessage: (any) => any) {
    this.extractMessage = extractMessage;
    this.pubsub = pubsub;
    this.pullQueue = [];
    this.pushQueue = [];
    this.listening = true;
    this.eventsArray = typeof eventNames === 'string' ? [eventNames] : eventNames;
    this.pubsub.addEventListener('new-topic', this.newTopicListener.bind(this));
    this.subscribedPromises = this.subscribeAll();
    this.allSubscribed = Promise.all(this.subscribedPromises);
  }

  public async next() {
    await this.allSubscribed;
    return this.listening ? this.pullValue() : this.return();
  }

  public async return() {
    const self = this;
    this.emptyQueue(await this.allSubscribed);
    return { value: self.extractMessage(undefined), done: true };
  }

  public async throw(error) {
    this.emptyQueue(await this.allSubscribed);
    return Promise.reject(error);
  }

  public [$$asyncIterator]() {
    return this;
  }

  private async newTopicListener(eventName: string, ds: IDynamicSubscription): Promise<void> {
    if (ds.enabled) {
      this.subscribedPromises.push(this.pubsub.subscribe(eventName, this.pushValue.bind(this), {}));
      this.allSubscribed = Promise.all(this.subscribedPromises);
      await this.allSubscribed;
    }
  }

  private async pushValue(event) {
    await this.allSubscribed;
    const self = this;
    if (this.pullQueue.length !== 0) {
      this.pullQueue.shift()({ value: self.extractMessage(event), done: false });
    } else {
      this.pushQueue.push(self.extractMessage(event));
    }
  }

  private pullValue(): Promise<IteratorResult<any>> {
    return new Promise(resolve => {
      if (this.pushQueue.length !== 0) {
        resolve({ value: this.pushQueue.shift(), done: false });
      } else {
        this.pullQueue.push(resolve);
      }
    });
  }

  private emptyQueue(subscriptionIds: number[]) {
    if (this.listening) {
      const self = this;
      this.listening = false;
      this.unsubscribeAll(subscriptionIds);
      this.pullQueue.forEach(resolve => resolve({ value: self.extractMessage(undefined), done: true }));
      this.pullQueue.length = 0;
      this.pushQueue.length = 0;
    }
  }

  private subscribeAll() {
    return this.eventsArray.map(
        eventName => this.pubsub.subscribe(eventName, this.pushValue.bind(this), {}),
    );
  }

  private unsubscribeAll(subscriptionIds: number[]) {
    for (const subscriptionId of subscriptionIds) {
      this.pubsub.unsubscribe(subscriptionId);
    }
  }

}
