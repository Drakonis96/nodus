// EventKit runs inside Nodus, so macOS grants access to Nodus's signed identity.
// Node-API async work keeps database access and the consent dialog off the JS thread.
#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>
#include <node_api.h>
#include <string>

static NSDictionary *failure(NSString *code) { return @{ @"error": code }; }
static NSString *stringValue(id value) { return [value isKindOfClass:[NSString class]] ? value : @""; }
static NSDate *dateValue(id value) {
  if (![value isKindOfClass:[NSNumber class]] || !isfinite([value doubleValue])) return nil;
  return [NSDate dateWithTimeIntervalSince1970:[value doubleValue] / 1000.0];
}
static BOOL fullAccess(void) {
  EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
  if (@available(macOS 14.0, *)) return status == EKAuthorizationStatusFullAccess;
  return status == EKAuthorizationStatusAuthorized;
}
static NSString *authorization(void) {
  if (fullAccess()) return @"authorized";
  switch ([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]) {
    case EKAuthorizationStatusNotDetermined: return @"notDetermined";
    case EKAuthorizationStatusRestricted: return @"restricted";
    case EKAuthorizationStatusDenied: return @"denied";
    default: return @"writeOnly";
  }
}
static BOOL allowedCalendar(EKCalendar *calendar) {
  if (!calendar || !calendar.allowsContentModifications || calendar.type == EKCalendarTypeSubscription) return NO;
  EKSource *source = calendar.source;
  // This release deliberately excludes Google, Exchange and other CalDAV accounts.
  // EventKit exposes no public provider ID: only admit local stores and the known
  // iCloud source name. Unknown sources are omitted, never guessed from an email.
  return source.sourceType == EKSourceTypeLocal ||
    (source.sourceType == EKSourceTypeCalDAV && [source.title caseInsensitiveCompare:@"iCloud"] == NSOrderedSame);
}
static BOOL ownedEvent(EKEvent *event, NSString *marker, EKCalendar *calendar) {
  return event && [event.calendar.calendarIdentifier isEqualToString:calendar.calendarIdentifier]
    && [[event.notes componentsSeparatedByString:@"\n"] containsObject:marker];
}

static NSDictionary *perform(NSDictionary *request) {
  NSString *action = stringValue(request[@"action"]);
  if ([action isEqualToString:@"status"]) return @{ @"authorization": authorization() };
  EKEventStore *store = [[EKEventStore alloc] init];
  if ([action isEqualToString:@"calendars"] && [request[@"requestAccess"] boolValue] && !fullAccess()) {
    // Missing purpose strings can cause TCC to kill the host. Development Electron
    // hosts have no purpose strings; packaged Nodus builds carry these keys.
    NSDictionary *info = [[NSBundle mainBundle] infoDictionary];
    if (!info[@"NSCalendarsFullAccessUsageDescription"] || !info[@"NSCalendarsUsageDescription"])
      return failure(@"APPLE_CALENDAR_USAGE_DESCRIPTION");
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    void (^completion)(BOOL, NSError *) = ^(BOOL granted, NSError *error) { dispatch_semaphore_signal(semaphore); };
    if (@available(macOS 14.0, *)) [store requestFullAccessToEventsWithCompletion:completion];
    else [store requestAccessToEntityType:EKEntityTypeEvent completion:completion];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC)) != 0)
      return failure(@"APPLE_CALENDAR_PERMISSION");
    [store reset];
  }
  if (!fullAccess()) return failure(@"APPLE_CALENDAR_PERMISSION");
  if ([action isEqualToString:@"calendars"]) {
    NSMutableArray *calendars = [NSMutableArray array];
    for (EKCalendar *calendar in [store calendarsForEntityType:EKEntityTypeEvent]) {
      if (allowedCalendar(calendar)) [calendars addObject:@{
        @"id": calendar.calendarIdentifier, @"title": calendar.title ?: @"", @"source": calendar.source.title ?: @""
      }];
    }
    return @{ @"calendars": calendars };
  }
  if (![action isEqualToString:@"upsert"] && ![action isEqualToString:@"remove"]) return failure(@"APPLE_CALENDAR_REQUEST");
  EKCalendar *calendar = [store calendarWithIdentifier:stringValue(request[@"calendarId"])];
  if (!allowedCalendar(calendar)) return failure(@"APPLE_CALENDAR_DESTINATION");
  NSString *marker = stringValue(request[@"marker"]);
  if (![marker hasPrefix:@"[Nodus:"] || ![marker hasSuffix:@"]"] || [marker containsString:@"\n"]) return failure(@"APPLE_CALENDAR_REQUEST");
  NSString *nativeId = stringValue(request[@"nativeId"]);
  EKEvent *event = nativeId.length ? [store eventWithIdentifier:nativeId] : nil;
  // A reused ID or a user-removed ownership marker must never overwrite an unrelated event.
  if (event && !ownedEvent(event, marker, calendar)) return failure(@"APPLE_CALENDAR_CONFLICT");
  NSDictionary *payload = [request[@"event"] isKindOfClass:[NSDictionary class]] ? request[@"event"] : @{};
  if (!event) {
    // Recover a successfully committed write whose JS acknowledgement was lost.
    // Date windows are separate (rather than min..max) to stay within EventKit's
    // four-year predicate limit when a local event is moved many years.
    NSArray *starts = @[payload[@"start"] ?: [NSNull null], request[@"previousStart"] ?: [NSNull null]];
    NSMutableDictionary<NSString *, EKEvent *> *matches = [NSMutableDictionary dictionary];
    for (id value in starts) {
      NSDate *start = dateValue(value);
      if (!start) continue;
      NSPredicate *predicate = [store predicateForEventsWithStartDate:[start dateByAddingTimeInterval:-172800]
        endDate:[start dateByAddingTimeInterval:172800] calendars:@[calendar]];
      for (EKEvent *candidate in [store eventsMatchingPredicate:predicate]) {
        if (ownedEvent(candidate, marker, calendar)) matches[candidate.eventIdentifier] = candidate;
      }
    }
    if (matches.count > 1) return failure(@"APPLE_CALENDAR_CONFLICT");
    event = matches.allValues.firstObject;
  }
  if (event.hasRecurrenceRules || event.organizer || event.attendees.count) return failure(@"APPLE_CALENDAR_CONFLICT");
  NSError *error = nil;
  if ([action isEqualToString:@"remove"]) {
    if (event && ![store removeEvent:event span:EKSpanThisEvent commit:YES error:&error]) return failure(@"APPLE_CALENDAR_SAVE");
    return @{ @"removed": @YES };
  }
  NSDate *start = dateValue(payload[@"start"]);
  NSDate *end = dateValue(payload[@"end"]);
  NSString *title = stringValue(payload[@"title"]);
  if (!start || !end || [end compare:start] != NSOrderedDescending || !title.length) return failure(@"APPLE_CALENDAR_REQUEST");
  if (!event) event = [EKEvent eventWithEventStore:store];
  event.calendar = calendar;
  event.title = title;
  event.startDate = start;
  event.endDate = end;
  event.allDay = [payload[@"allDay"] boolValue];
  event.timeZone = [NSTimeZone timeZoneWithName:stringValue(payload[@"timeZone"])] ?: [NSTimeZone localTimeZone];
  NSString *description = stringValue(payload[@"description"]);
  event.notes = description.length ? [NSString stringWithFormat:@"%@\n\n%@", description, marker] : marker;
  NSString *url = stringValue(payload[@"url"]);
  NSURL *parsedURL = [NSURL URLWithString:url];
  event.URL = ([@"https" isEqualToString:parsedURL.scheme.lowercaseString] || [@"http" isEqualToString:parsedURL.scheme.lowercaseString]) ? parsedURL : nil;
  NSDate *reminder = dateValue(payload[@"reminder"]);
  event.alarms = reminder ? @[[EKAlarm alarmWithAbsoluteDate:reminder]] : @[];
  if (![store saveEvent:event span:EKSpanThisEvent commit:YES error:&error]) return failure(@"APPLE_CALENDAR_SAVE");
  if (!event.eventIdentifier.length) return failure(@"APPLE_CALENDAR_SAVE");
  return @{ @"nativeId": event.eventIdentifier };
}

struct Job { napi_async_work work; napi_deferred deferred; std::string request; std::string result; };
static void execute(napi_env env, void *data) {
  Job *job = static_cast<Job *>(data);
  @autoreleasepool {
    NSDictionary *result;
    @try {
      NSData *bytes = [NSData dataWithBytes:job->request.data() length:job->request.size()];
      id request = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
      result = [request isKindOfClass:[NSDictionary class]] ? perform(request) : failure(@"APPLE_CALENDAR_REQUEST");
    } @catch (NSException *exception) { result = failure(@"APPLE_CALENDAR_SAVE"); }
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    job->result.assign(static_cast<const char *>(json.bytes), json.length);
  }
}
static void complete(napi_env env, napi_status status, void *data) {
  Job *job = static_cast<Job *>(data);
  napi_value result;
  const char *output = status == napi_ok ? job->result.c_str() : "{\"error\":\"APPLE_CALENDAR_SAVE\"}";
  napi_create_string_utf8(env, output, NAPI_AUTO_LENGTH, &result);
  napi_resolve_deferred(env, job->deferred, result);
  napi_delete_async_work(env, job->work);
  delete job;
}
static napi_value invoke(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr);
  size_t size = 0;
  if (argc != 1 || napi_get_value_string_utf8(env, argument, nullptr, 0, &size) != napi_ok || size > 1048576) {
    napi_throw_type_error(env, nullptr, "Expected a calendar request JSON string (max 1 MiB).");
    return nullptr;
  }
  Job *job = new Job();
  job->request.resize(size + 1);
  napi_get_value_string_utf8(env, argument, job->request.data(), size + 1, &size);
  job->request.resize(size);
  napi_value promise, name;
  napi_create_promise(env, &job->deferred, &promise);
  napi_create_string_utf8(env, "NodusEventKit", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, execute, complete, job, &job->work) != napi_ok) {
    delete job; napi_throw_error(env, nullptr, "Cannot create EventKit work."); return nullptr;
  }
  if (napi_queue_async_work(env, job->work) != napi_ok) {
    napi_delete_async_work(env, job->work); delete job;
    napi_throw_error(env, nullptr, "Cannot queue EventKit work."); return nullptr;
  }
  return promise;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "invoke", NAPI_AUTO_LENGTH, invoke, nullptr, &function);
  napi_set_named_property(env, exports, "invoke", function);
  return exports;
}
NAPI_MODULE(nodus_apple_calendar, initialize)
