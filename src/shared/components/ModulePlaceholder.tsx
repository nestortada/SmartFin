import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type ModulePlaceholderProps = {
  title: string;
  description: string;
};

export function ModulePlaceholder({ title, description }: ModulePlaceholderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  title: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  description: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 20,
  },
});
