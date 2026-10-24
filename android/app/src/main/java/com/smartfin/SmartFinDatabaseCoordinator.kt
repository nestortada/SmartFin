package com.smartfin

import android.os.Looper
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Process-local lifecycle gate. No SQLite handles, JS callbacks or thread-owned leases. */
object SmartFinDatabaseCoordinator {
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  private val waiting = ArrayDeque<String>()
  private val revokedHosts = mutableSetOf<String>()
  private var generation = 0L
  private var exclusive: Owner? = null
  private var independent = 0
  private var quarantined = false

  private class Owner(val host: String, val generation: Long) {
    val token = UUID.randomUUID().toString()
    var participants = 0
    var revoked = false
  }

  class Participant internal constructor(
    internal val token: String?,
    internal val generation: Long,
  ) : AutoCloseable {
    internal var active = true
    override fun close() = finish(this)
  }

  private fun background() {
    check(Looper.myLooper() != Looper.getMainLooper()) { "Database gate cannot wait on UI" }
  }

  fun acquire(host: String, timeoutMs: Long = 10_000): String {
    background()
    val request = UUID.randomUUID().toString()
    var remaining = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    lock.withLock {
      waiting.addLast(request)
      try {
        while (true) {
          check(!quarantined && host !in revokedHosts) { "Database lifecycle quarantined; restart process" }
          if (waiting.first() == request && exclusive == null && independent == 0) {
            val owner = Owner(host, ++generation)
            exclusive = owner
            return owner.token
          }
          check(remaining > 0) { "Database permission acquisition timed out" }
          remaining = changed.awaitNanos(remaining)
        }
      } finally {
        waiting.remove(request)
        changed.signalAll()
      }
    }
  }

  fun participate(token: String? = null, timeoutMs: Long = 2_000): Participant {
    background()
    var remaining = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    lock.withLock {
      while (true) {
        check(!quarantined) { "Database lifecycle quarantined; restart process" }
        if (token != null) {
          val owner = exclusive
          check(owner != null && owner.token == token && !owner.revoked) { "Native owner is revoked or invalid" }
          owner.participants++
          return Participant(token, owner.generation)
        }
        if (exclusive == null && waiting.isEmpty()) {
          independent++
          return Participant(null, generation)
        }
        check(remaining > 0) { "Database participation acquisition timed out" }
        remaining = changed.awaitNanos(remaining)
      }
    }
  }

  fun assertParticipant(permit: Participant) = lock.withLock {
    check(permit.active && !quarantined) { "Native participant is revoked" }
    if (permit.token != null) {
      val owner = exclusive
      check(owner != null && owner.token == permit.token && owner.generation == permit.generation && !owner.revoked)
    }
  }

  private fun finish(permit: Participant) = lock.withLock {
    if (permit.active) {
      permit.active = false
      if (permit.token == null) independent--
      else {
        val owner = exclusive
        check(owner != null && owner.token == permit.token && owner.generation == permit.generation)
        owner.participants--
      }
      changed.signalAll()
    }
  }

  fun release(host: String, token: String) {
    background()
    lock.withLock {
      val owner = exclusive
      check(owner != null && owner.host == host && owner.token == token) { "Invalid native release" }
      owner.revoked = true
      // No timeout: existing work keeps its protection until it really finishes.
      while (owner.participants != 0) changed.await()
      if (!quarantined) exclusive = null
      changed.signalAll()
    }
  }

  fun quarantine() = lock.withLock {
    quarantined = true
    exclusive?.revoked = true
    changed.signalAll()
  }

  fun isQuarantined(): Boolean = lock.withLock { quarantined }

  fun invalidateHost(host: String) = lock.withLock {
    revokedHosts.add(host)
    // The RN driver may still own a connection or a queued native operation.
    // Without its confirmed close, only a process restart certifies its destruction.
    quarantined = true
    exclusive?.revoked = true
    changed.signalAll()
  }

  fun <T> withParticipant(token: String? = null, operation: (Participant) -> T): T =
    participate(token).use(operation)
}
