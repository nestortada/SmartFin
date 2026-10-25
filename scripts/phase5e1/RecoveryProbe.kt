package com.smartfin

import android.content.Context
import java.util.concurrent.CountDownLatch

/** Observes completion only. Never installs an uncaught exception handler. */
object Phase5E1RecoveryProbe {
  @Volatile var finished = CountDownLatch(1)
  @Volatile var fail = false
  fun before() { if (fail) { fail = false; throw java.io.IOException("Synthetic unexpected recovery failure") } }
  fun finished() { finished.countDown() }
}
