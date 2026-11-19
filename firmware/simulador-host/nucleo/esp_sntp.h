/* NTP simulado: sincroniza 2 s (virtuales) después de configTime(). */
#pragma once
#include <sys/time.h>
typedef void (*sntp_sync_time_cb_t)(struct timeval *tv);
void sntp_set_time_sync_notification_cb(sntp_sync_time_cb_t cb);
void configTime(long gmt_offset_s, int daylight_s, const char *s1, const char *s2 = nullptr, const char *s3 = nullptr);
